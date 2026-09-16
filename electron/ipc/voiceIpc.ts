import { ipcMain } from 'electron';
import { localWhisperService } from '../services/localWhisperService';
import { voiceHotkeyService } from '../services/voiceHotkeyService';
import { aiAgentService, type AIMessage } from '../services/aiAgentService';
import { computerUseService } from '../services/computerUseService';
import type { ToolExecutionResult } from '../services/apiToolLoop';
import {
  VoiceClassifierCache,
  buildVoiceClassifierPrompt,
  isConfident,
  parseVoiceClassifierResponse
} from '../services/voiceCommandClassifier';
import type { IpcContext } from './types';

/**
 * Кэш частых фраз классификатора (TASK-83 п. 2): живёт на процесс, а не на окно — одни и те же
 * команды повторяются в каждой сессии, и платить за них запросом к модели незачем.
 */
const classifierCache = new VoiceClassifierCache();

/** Классификатору хватает десятков токенов; ждать дольше бессмысленно — это голосовая команда. */
const CLASSIFY_MAX_TOKENS = 200;
const CLASSIFY_TIMEOUT_MS = 12_000;

function toStringList(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return list.length > 0 ? list.slice(0, limit) : undefined;
}

/** Голосовая команда — это один короткий ход, а не сессия: лимит шагов и общий таймаут. */
const COMPUTER_TASK_MAX_STEPS = 8;
const COMPUTER_TASK_TIMEOUT_MS = 120_000;
const DICTATION_PUNCTUATION_TIMEOUT_MS = 8_000;

/**
 * Инструкция голосовой задачи управления компьютером (TASK-83 п. 4). Accessibility-first правила
 * добавляет сам `aiAgentService`, когда у хода есть инструменты `computer_*` (decision-27); здесь —
 * только то, что специфично для голоса: один ход, короткий разговорный итог.
 */
const COMPUTER_TASK_SYSTEM = [
  'Ты выполняешь одну короткую команду пользователя на его компьютере, отданную голосом.',
  'Сделай ровно то, что попросили, и ничего сверх этого. Не задавай уточняющих вопросов —',
  'если команду выполнить нельзя, просто скажи почему.',
  'Ответь одной короткой фразой, которую не стыдно прочитать вслух: «Готово» или, например,',
  '«Не нашёл кнопку Сохранить». Без кода, без списков и без markdown-разметки.'
].join(' ');

function computerResultToText(content: Array<{ type: string; text?: string }>): string {
  return content
    .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
    .filter(Boolean)
    .join('\n');
}

export function registerVoiceIpc(ctx: IpcContext) {
  // Voice Overlay Sync & Action
  ipcMain.on('voice:overlay-sync', (_event, state) => {
    const shouldBeVisible = Boolean(state?.isListening || state?.isPaused);
    let voiceOverlayWin = ctx.getVoiceOverlayWindow();

    if (shouldBeVisible) {
      if (!voiceOverlayWin || voiceOverlayWin.isDestroyed()) {
        voiceOverlayWin = ctx.createVoiceOverlayWindow();
      }
    }

    if (voiceOverlayWin && !voiceOverlayWin.isDestroyed()) {
      if (shouldBeVisible) {
        if (!voiceOverlayWin.isVisible()) {
          voiceOverlayWin.showInactive();
        }
      } else {
        if (voiceOverlayWin.isVisible()) {
          voiceOverlayWin.hide();
        }
      }

      if (!voiceOverlayWin.webContents.isLoading()) {
        voiceOverlayWin.webContents.send('voice:overlay-update', state);
      } else {
        voiceOverlayWin.webContents.once('did-finish-load', () => {
          voiceOverlayWin?.webContents.send('voice:overlay-update', state);
        });
      }
    }
  });

  ipcMain.on('voice:overlay-action', (_event, action) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('voice:external-control', action);
    }
  });

  // Local Whisper STT Engine
  ipcMain.handle('voice:transcribeLocal', async (_event, { audioData, language }) => {
    return await localWhisperService.transcribe(audioData, language);
  });

  ipcMain.handle('voice:getLocalWhisperStatus', async () => {
    return localWhisperService.getState();
  });

  ipcMain.handle('voice:warmupLocalWhisper', async () => {
    localWhisperService.initBackground();
    return localWhisperService.getState();
  });

  // ─────────────── Push-to-talk: глобальная горячая клавиша (TASK-83 п. 1) ───────────────

  ipcMain.handle('voice:getPushToTalkStatus', async () => voiceHotkeyService.getStatus());

  ipcMain.handle('voice:savePushToTalkSettings', async (_event, patch: unknown) => {
    const safePatch = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    await voiceHotkeyService.saveSettings(safePatch);
    return voiceHotkeyService.getStatus();
  });

  // ─────────────── Классификатор свободных команд (TASK-83 п. 2) ───────────────

  /**
   * Фраза, которую не узнал разбор регулярками, уходит настроенной модели. Ошибка модели —
   * штатный исход: вызывающий код показывает «не понял команду», а не падает. Провайдера и
   * модель выбирает пользователь, своих дефолтов здесь нет ([[decision-26]] п. 0).
   */
  ipcMain.handle('voice:classifyCommand', async (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const transcript = typeof request.transcript === 'string' ? request.transcript.trim() : '';
    if (!transcript) return { ok: false, result: null, error: 'empty_transcript' };

    const language: 'ru' | 'en' = request.language === 'en' ? 'en' : 'ru';
    const now = Date.now();

    const cached = classifierCache.get(transcript, language, now);
    if (cached) return { ok: true, cached: true, result: cached, confident: isConfident(cached) };

    try {
      const prompt = buildVoiceClassifierPrompt({
        transcript,
        language,
        projectNames: toStringList(request.projectNames, 20),
        hasPendingApproval: request.hasPendingApproval === true,
        computerUseEnabled: computerUseService.isEnabled()
      });

      const completion = await aiAgentService.complete({
        prompt,
        maxTokens: CLASSIFY_MAX_TOKENS,
        temperature: 0,
        timeoutMs: CLASSIFY_TIMEOUT_MS
      });

      const result = parseVoiceClassifierResponse(completion.text);
      classifierCache.set(transcript, language, result, now);
      return {
        ok: true,
        cached: false,
        result,
        // Порог уверенности живёт рядом с классификатором: рендереру незачем знать его значение.
        confident: isConfident(result),
        model: completion.model,
        provider: completion.provider
      };
    } catch (err) {
      return { ok: false, result: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─────────────── Голос → компьютер (TASK-83 п. 4) ───────────────

  /**
   * Голосовая команда «кликни…/напечатай…/открой окно…» выполняется агентом с инструментами
   * `computer_*` в один ход. HITL, allowlist, аудит и kill-switch остаются внутри
   * `computerUseService.callTool` ([[decision-27]]) — здесь они не дублируются и не обходятся.
   * Фича по умолчанию выключена, и включать её сами мы не предлагаем (правило 20 infra-dev):
   * при выключенной фиче просто возвращаем код причины.
   */
  ipcMain.handle('voice:runComputerTask', async (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const task = typeof request.task === 'string' ? request.task.trim() : '';
    const projectPath = typeof request.projectPath === 'string' ? request.projectPath : '';
    if (!task) return { ok: false, error: 'empty_task' };
    if (!computerUseService.isEnabled()) return { ok: false, error: 'computer_use_disabled' };

    const tools = computerUseService.listProxyTools();
    if (tools.length === 0) return { ok: false, error: 'computer_use_unavailable' };

    const config = await aiAgentService.getConfig();
    const sessionId = `voice-computer-${Date.now()}`;
    const messages: AIMessage[] = [
      { id: sessionId, role: 'user', content: task, timestamp: new Date().toISOString() }
    ];

    return await new Promise<{ ok: boolean; text?: string; error?: string }>((resolve) => {
      let settled = false;
      const finish = (value: { ok: boolean; text?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      // streamChat при отмене не зовёт ни onComplete, ни onError — без своего таймера промис завис бы.
      const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), COMPUTER_TASK_TIMEOUT_MS);

      void aiAgentService.streamChat(
        {
          sessionId,
          projectPath,
          messages,
          config,
          mode: 'agent',
          roleSystemPrompt: COMPUTER_TASK_SYSTEM,
          // Только инструменты компьютера: чтение файлов, запись и запуск команд голосовой
          // команде не нужны, а allow-список фильтрует и родные инструменты агента.
          allowedToolNames: tools.map((tool) => tool.name)
        },
        () => {},
        (msg) => finish({ ok: true, text: msg.content || '' }),
        (err) => finish({ ok: false, error: err }),
        {
          computerTools: tools,
          maxSteps: COMPUTER_TASK_MAX_STEPS,
          executeTool: async (tc): Promise<ToolExecutionResult> => {
            if (!tc.name.startsWith('computer_')) {
              return { content: 'Этот инструмент недоступен в голосовой команде.', isError: true };
            }
            const res = await computerUseService.callTool(tc.name, tc.args, {
              sessionId,
              projectPath,
              origin: 'studio',
              engine: 'api'
            });
            const text = computerResultToText(res.content);
            const images = res.content.flatMap((part) =>
              part.type === 'image' ? [{ mimeType: part.mimeType, data: part.data }] : []
            );
            return { content: text, isError: res.isError, images };
          }
        }
      );
    });
  });

  // ─────────────── Системная диктовка (TASK-83 п. 5) ───────────────

  /**
   * Печатает распознанный текст в активное окно через `computer_type`. Проверку окна по allowlist
   * и запрос подтверждения делает политика внутри `callTool`: `type` — действие класса `act`, и вне
   * разрешённых окон оно само уйдёт человеку на подтверждение.
   */
  ipcMain.handle('voice:dictateText', async (_event, payload: unknown) => {
    const request = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const raw = typeof request.text === 'string' ? request.text.trim() : '';
    const projectPath = typeof request.projectPath === 'string' ? request.projectPath : '';
    if (!raw) return { ok: false, error: 'empty_text' };
    if (!computerUseService.isEnabled()) return { ok: false, error: 'computer_use_disabled' };

    let text = raw;
    if (request.punctuate === true) {
      try {
        const completion = await aiAgentService.complete({
          prompt:
            'Расставь в тексте знаки препинания и заглавные буквы. Слова, их порядок и язык не меняй, ' +
            'ничего не добавляй и не убирай, не комментируй. Верни только исправленный текст.\n\n' +
            raw,
          maxTokens: Math.min(1024, Math.ceil(raw.length / 2) + 64),
          temperature: 0,
          timeoutMs: DICTATION_PUNCTUATION_TIMEOUT_MS
        });
        const punctuated = completion.text.trim();
        if (punctuated) text = punctuated;
      } catch (err) {
        // Пунктуация — необязательная надстройка: молчим и печатаем как распознали.
        console.warn('[Voice] Пунктуация через модель не удалась:', err);
      }
    }

    const res = await computerUseService.callTool('computer_type', { text }, {
      sessionId: 'voice-dictation',
      projectPath,
      origin: 'studio',
      engine: 'api'
    });

    const detail = computerResultToText(res.content);
    if (res.isError) return { ok: false, error: detail || 'type_failed' };
    return { ok: true, typed: text, detail };
  });
}
