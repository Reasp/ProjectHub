import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { searchProjectDocs } from './ragSearch.js';
import { secretStorageService } from './secretStorageService.js';
import matter from 'gray-matter';

export interface AutoApproveRules {
  enabled: boolean;
  allowCommands: boolean;
  allowFileWrite: boolean;
  allowFileRead: boolean;
  allowSubagents: boolean;
  writeExcludePatterns: string[];
  readExcludePatterns: string[];
  commandDenyList: string[];
}

export interface AIProviderConfig {
  provider: 'anthropic' | 'openrouter' | 'deepseek' | 'ollama' | 'custom';
  apiKey?: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  thinkingBudget?: number;
  autoApprove?: boolean;
  autoApproveRules?: AutoApproveRules;
}

export interface AIToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  status?: 'pending' | 'accepted' | 'rejected' | 'running' | 'done' | 'error';
  result?: any;
  diff?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    patch: string;
  };
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thought?: string;
  toolCalls?: AIToolCall[];
  timestamp: string;
}

export interface AIStreamRequest {
  sessionId: string;
  projectPath: string;
  messages: AIMessage[];
  config: AIProviderConfig;
  mode: 'chat' | 'agent' | 'architect';
}

export interface ClaudeAuthStatus {
  isLoggedIn: boolean;
  email?: string;
  displayName?: string;
  seatTier?: string;
  organizationName?: string;
}

export const PROJECT_HUB_CLAUDE_DIR = path.join(os.homedir(), '.projecthub', 'claude_config');
const CONFIG_FILE = path.join(os.homedir(), '.projecthub', 'ai-config.json');

class AIAgentService {
  private activeControllers = new Map<string, AbortController>();

  constructor() {
    this.ensureConfigDir();
  }

  private ensureConfigDir() {
    // Синхронно: промис fs.mkdir без await внутри try не ловится и становится unhandled rejection
    const dir = path.dirname(CONFIG_FILE);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error('Failed to create config dir:', e);
      }
    }
    if (!existsSync(PROJECT_HUB_CLAUDE_DIR)) {
      try {
        mkdirSync(PROJECT_HUB_CLAUDE_DIR, { recursive: true });
      } catch (e) {
        console.error('Failed to create claude config dir:', e);
      }
    }
  }

  public async getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
    const isolatedClaudeJson = path.join(PROJECT_HUB_CLAUDE_DIR, '.claude.json');
    const globalClaudeJson = path.join(os.homedir(), '.claude.json');
    const targetPaths = [isolatedClaudeJson, globalClaudeJson];

    for (const claudeJsonPath of targetPaths) {
      if (existsSync(claudeJsonPath)) {
        try {
          const content = await fs.readFile(claudeJsonPath, 'utf-8');
          const data = JSON.parse(content);
          if (data.oauthAccount && (data.oauthAccount.emailAddress || data.oauthAccount.email)) {
            return {
              isLoggedIn: true,
              email: data.oauthAccount.emailAddress || data.oauthAccount.email,
              displayName: data.oauthAccount.displayName || data.oauthAccount.fullName,
              seatTier: data.oauthAccount.seatTier || data.oauthAccount.billingType || 'Pro / Team',
              organizationName: data.oauthAccount.organizationName
            };
          }
        } catch (e) {
          console.warn(`Failed to read ${claudeJsonPath}:`, e);
        }
      }
    }
    return { isLoggedIn: false };
  }

  public async claudeLogout(): Promise<boolean> {
    const isolatedClaudeJson = path.join(PROJECT_HUB_CLAUDE_DIR, '.claude.json');
    const globalClaudeJson = path.join(os.homedir(), '.claude.json');
    const targetPaths = [isolatedClaudeJson, globalClaudeJson];

    for (const claudeJsonPath of targetPaths) {
      if (existsSync(claudeJsonPath)) {
        try {
          const content = await fs.readFile(claudeJsonPath, 'utf-8');
          const data = JSON.parse(content);
          if (data.oauthAccount) {
            delete data.oauthAccount;
            delete data.primaryApiKey;
            await fs.writeFile(claudeJsonPath, JSON.stringify(data, null, 2), 'utf-8');
          }
        } catch (e) {
          console.warn(`Failed to clean oauthAccount from ${claudeJsonPath}:`, e);
        }
      }
    }

    try {
      const credsFile = path.join(PROJECT_HUB_CLAUDE_DIR, '.credentials.json');
      if (existsSync(credsFile)) {
        await fs.unlink(credsFile);
      }
    } catch {}

    try {
      const isWin = process.platform === 'win32';
      if (isWin) {
        spawn('cmd.exe', ['/c', 'claude auth logout'], {
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
          }
        });
      } else {
        spawn('claude', ['auth', 'logout'], {
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
          }
        });
      }
    } catch (e) {
      console.warn('Failed to spawn claude auth logout:', e);
    }

    return true;
  }

  public async getConfig(): Promise<AIProviderConfig> {
    try {
      if (existsSync(CONFIG_FILE)) {
        const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.apiKey) {
          parsed.apiKey = secretStorageService.decrypt(parsed.apiKey);
        }
        return parsed;
      }
    } catch (err) {
      console.warn('Failed to load AI config, using defaults:', err);
    }

    return {
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      temperature: 0.7,
      thinkingBudget: 2048
    };
  }

  public async saveConfig(config: AIProviderConfig): Promise<void> {
    this.ensureConfigDir();
    const toSave = { ...config };
    if (toSave.apiKey) {
      toSave.apiKey = secretStorageService.encrypt(toSave.apiKey);
    }
    await fs.writeFile(CONFIG_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
  }

  public abortStream(sessionId: string): void {
    const controller = this.activeControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(sessionId);
    }
  }

  /**
   * Helper to compute unified diff text between old and new strings
   */
  public generateDiff(oldStr: string, newStr: string, fileName = 'file'): string {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');

    let diffText = `--- a/${fileName}\n+++ b/${fileName}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

    // Simple line-by-line comparison
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o === n) {
        diffText += ` ${o ?? ''}\n`;
      } else {
        if (o !== undefined) diffText += `-${o}\n`;
        if (n !== undefined) diffText += `+${n}\n`;
      }
    }
    return diffText.trim();
  }

  /**
   * Execute safe file write after user approval
   */
  public async applyDiff(projectPath: string, relativePath: string, newContent: string): Promise<boolean> {
    const fullPath = path.isAbsolute(relativePath) ? relativePath : path.join(projectPath, relativePath);
    const parentDir = path.dirname(fullPath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(fullPath, newContent, 'utf-8');
    return true;
  }

  /**
   * Main Stream Chat Dispatcher
   */
  public async streamChat(
    req: AIStreamRequest,
    onChunk: (payload: { text?: string; thought?: string; toolCall?: AIToolCall }) => void,
    onComplete: (msg: AIMessage) => void,
    onError: (err: string) => void
  ): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(req.sessionId, controller);

    try {
      const systemPrompt = await this.buildSystemPrompt(req.projectPath, req.mode);

      if (req.config.provider === 'anthropic') {
        await this.streamAnthropic(req, systemPrompt, controller.signal, onChunk, onComplete, onError);
      } else {
        await this.streamOpenAICompatible(req, systemPrompt, controller.signal, onChunk, onComplete, onError);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        onChunk({ text: '\n\n*(Отменено пользователем)*' });
      } else {
        onError(err.message || String(err));
      }
    } finally {
      this.activeControllers.delete(req.sessionId);
    }
  }

  /**
   * Anthropic Claude API Streaming
   */
  private async streamAnthropic(
    req: AIStreamRequest,
    systemPrompt: string,
    signal: AbortSignal,
    onChunk: (payload: { text?: string; thought?: string; toolCall?: AIToolCall }) => void,
    onComplete: (msg: AIMessage) => void,
    onError: (err: string) => void
  ): Promise<void> {
    const apiKey = req.config.apiKey?.trim();
    if (!apiKey) {
      throw new Error('API ключ Anthropic не указан. Пожалуйста, откройте настройки AI Studio и укажите ключ.');
    }

    const endpoint = 'https://api.anthropic.com/v1/messages';
    const messages = req.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.content
      }));

    const tools = req.mode === 'agent' ? this.getAnthropicTools() : undefined;

    const body: Record<string, any> = {
      model: req.config.model || 'claude-3-7-sonnet-20250219',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    if (req.config.thinkingBudget && req.config.thinkingBudget > 0 && req.config.model.includes('3-7')) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: req.config.thinkingBudget
      };
    } else {
      body.temperature = req.config.temperature ?? 0.7;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API Error (${response.status}): ${errText}`);
    }

    let fullText = '';
    let fullThought = '';
    const toolCalls: AIToolCall[] = [];
    let currentTool: { id: string; name: string; argsStr: string } | null = null;

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is empty');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'text_delta') {
              const chunk = parsed.delta.text;
              fullText += chunk;
              onChunk({ text: chunk });
            } else if (parsed.delta?.type === 'thinking_delta') {
              const chunk = parsed.delta.thinking;
              fullThought += chunk;
              onChunk({ thought: chunk });
            } else if (parsed.delta?.type === 'input_json_delta' && currentTool) {
              currentTool.argsStr += parsed.delta.partial_json;
            }
          } else if (parsed.type === 'content_block_start') {
            if (parsed.content_block?.type === 'tool_use') {
              currentTool = {
                id: parsed.content_block.id,
                name: parsed.content_block.name,
                argsStr: ''
              };
            }
          } else if (parsed.type === 'content_block_stop') {
            if (currentTool) {
              let args: Record<string, any> = {};
              try {
                args = JSON.parse(currentTool.argsStr || '{}');
              } catch (e) {
                console.error('Failed to parse tool args:', e);
              }

              const toolCall: AIToolCall = {
                id: currentTool.id,
                name: currentTool.name,
                args,
                status: 'pending'
              };

              // Prepare diff if write_file
              if (currentTool.name === 'write_file' && args.filePath && args.content) {
                const targetPath = path.isAbsolute(args.filePath)
                  ? args.filePath
                  : path.join(req.projectPath, args.filePath);
                let oldContent = '';
                if (existsSync(targetPath)) {
                  oldContent = await fs.readFile(targetPath, 'utf-8').catch(() => '');
                }
                toolCall.diff = {
                  filePath: args.filePath,
                  oldContent,
                  newContent: args.content,
                  patch: this.generateDiff(oldContent, args.content, args.filePath)
                };
              }

              toolCalls.push(toolCall);
              onChunk({ toolCall });
              currentTool = null;
            }
          }
        } catch (err) {
          // ignore stream parse errors
        }
      }
    }

    onComplete({
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: fullText,
      thought: fullThought || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls.map((tc) => ({
        ...tc,
        status: tc.status || (tc.diff ? 'pending' : 'done')
      })) : undefined,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * OpenAI Compatible API Streaming (OpenRouter, DeepSeek, Ollama, etc.)
   */
  private async streamOpenAICompatible(
    req: AIStreamRequest,
    systemPrompt: string,
    signal: AbortSignal,
    onChunk: (payload: { text?: string; thought?: string; toolCall?: AIToolCall }) => void,
    onComplete: (msg: AIMessage) => void,
    onError: (err: string) => void
  ): Promise<void> {
    let endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    let headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    const apiKey = req.config.apiKey?.trim();

    if (req.config.provider === 'openrouter') {
      if (!apiKey) {
        throw new Error('API ключ OpenRouter не указан в настройках.');
      }
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['HTTP-Referer'] = 'https://projecthub.local';
      headers['X-Title'] = 'ProjectHub AI Studio';
    } else if (req.config.provider === 'deepseek') {
      if (!apiKey) {
        throw new Error('API ключ DeepSeek не указан в настройках.');
      }
      endpoint = 'https://api.deepseek.com/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (req.config.provider === 'ollama') {
      const base = (req.config.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
      endpoint = `${base}/v1/chat/completions`;
    } else if (req.config.provider === 'custom') {
      endpoint = req.config.baseUrl || 'http://localhost:8000/v1/chat/completions';
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role,
          content: m.content
        }))
    ];

    const body: Record<string, any> = {
      model: req.config.model || 'deepseek/deepseek-chat',
      messages,
      temperature: req.config.temperature ?? 0.7,
      stream: true
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API Error (${response.status}): ${errText}`);
    }

    let fullText = '';
    let fullThought = '';

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is empty');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta) {
            if (delta.reasoning_content) {
              fullThought += delta.reasoning_content;
              onChunk({ thought: delta.reasoning_content });
            }
            if (delta.content) {
              fullText += delta.content;
              onChunk({ text: delta.content });
            }
          }
        } catch (e) {
          // ignore chunk parse errors
        }
      }
    }

    onComplete({
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: fullText,
      thought: fullThought || undefined,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * System Prompt with Project Context
   */
  private async buildSystemPrompt(projectPath: string, mode: 'chat' | 'agent' | 'architect'): Promise<string> {
    return `You are Claude Code, Anthropic's official AI assistant for software development.
Working directory: "${projectPath}".
Answer directly, clearly, and concisely as Claude Code. If the user addresses you in Russian, answer naturally in Russian while preserving technical terms, file paths, and code.`;
  }

  /**
   * Anthropic Tool Definitions
   */
  private getAnthropicTools() {
    return [
      {
        name: 'read_file',
        description: 'Прочитать содержимое файла проекта',
        input_schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Относительный или абсолютный путь к файлу' }
          },
          required: ['filePath']
        }
      },
      {
        name: 'write_file',
        description: 'Создать или изменить файл проекта (показывает интерактивный Diff пользователю)',
        input_schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Относительный или абсолютный путь к файлу' },
            content: { type: 'string', description: 'Полное новое содержимое файла' },
            explanation: { type: 'string', description: 'Краткое объяснение внесенных изменений' }
          },
          required: ['filePath', 'content']
        }
      },
      {
        name: 'list_dir',
        description: 'Получить список файлов и подкаталогов в директории проекта',
        input_schema: {
          type: 'object',
          properties: {
            subDir: { type: 'string', description: 'Относительный путь подкаталога (пустая строка для корня)' }
          }
        }
      },
      {
        name: 'search_rag',
        description: 'Семантический поиск по документации и ADR проекта через LanceDB',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Поисковый запрос на естественном языке' }
          },
          required: ['query']
        }
      },
      {
        name: 'ask_question',
        description: 'Задать интерактивный вопрос пользователю с выбором вариантов (радиокнопки, чекбоксы, свой вариант)',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Краткий заголовок вопроса (например, "Что делаем?")' },
            question: { type: 'string', description: 'Развернутый текст вопроса пользователю' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Название варианта ответа' },
                  description: { type: 'string', description: 'Подробное описание или действие для этого варианта' }
                },
                required: ['label']
              },
              description: 'Список вариантов ответа (от 2 до 10 вариантов)'
            },
            is_multi_select: { type: 'boolean', description: 'Если true — множественный выбор (чекбоксы), если false — одиночный (радиокнопки)' }
          },
          required: ['question', 'options']
        }
      }
    ];
  }
}

export const aiAgentService = new AIAgentService();
