import { describe, expect, it } from 'vitest';
import { effortTargetKind, parseReasoningEffort, withReasoningEffort } from '../../src/lib/reasoningEffort';

describe('effortTargetKind: куда уйдёт усилие (подсказка UI, TASK-70.3)', () => {
  it('движки CLI', () => {
    expect(effortTargetKind({ engine: 'claude-cli' })).toBe('claude-cli');
    expect(effortTargetKind({ engine: 'codex-cli', provider: 'anthropic' })).toBe('cli-ignored');
    expect(effortTargetKind({ engine: 'gemini-cli' })).toBe('cli-ignored');
  });

  it('Anthropic: с ключом — API, без ключа (сессия AI Studio) — Claude CLI', () => {
    expect(effortTargetKind({ provider: 'anthropic', hasApiKey: true })).toBe('anthropic-api');
    expect(effortTargetKind({ provider: 'anthropic', hasApiKey: false })).toBe('claude-cli');
    expect(effortTargetKind({ engine: 'api', provider: 'anthropic' })).toBe('anthropic-api');
  });

  it('профиль — по формату усилия, прежние провайдеры — как их флаги', () => {
    expect(effortTargetKind({ provider: 'openai-compatible', profileReasoning: 'ollama_think' })).toBe('openai-compatible');
    expect(effortTargetKind({ provider: 'openai-compatible', profileReasoning: 'none' })).toBe('not-sent');
    expect(effortTargetKind({ provider: 'openai-compatible' })).toBe('not-sent');
    expect(effortTargetKind({ provider: 'ollama' })).toBe('openai-compatible');
    expect(effortTargetKind({ provider: 'openrouter' })).toBe('openai-compatible');
    expect(effortTargetKind({ provider: 'deepseek' })).toBe('not-sent');
    expect(effortTargetKind({ engine: 'api' })).toBe('studio');
  });
});

describe('withReasoningEffort / parseReasoningEffort', () => {
  it('меняет только усилие; пустой конфиг — undefined', () => {
    expect(withReasoningEffort({ provider: 'ollama', model: 'q' }, 'high')).toEqual({ provider: 'ollama', model: 'q', reasoningEffort: 'high' });
    expect(withReasoningEffort({ model: 'q', reasoningEffort: 'high' }, undefined)).toEqual({ model: 'q' });
    expect(withReasoningEffort({ reasoningEffort: 'high' }, undefined)).toBeUndefined();
    expect(withReasoningEffort(undefined, 'none')).toEqual({ reasoningEffort: 'none' });
  });

  it('парсинг значения select', () => {
    expect(parseReasoningEffort('')).toBeUndefined();
    expect(parseReasoningEffort('max')).toBe('max');
    expect(parseReasoningEffort('xhigh')).toBeUndefined();
  });
});
