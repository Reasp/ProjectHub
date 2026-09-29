import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildFileUrl,
  defaultUserDataDir,
  isSupportedPython,
  normalizeEndpoint,
  parseModelKinds,
  parsePythonVersion,
  parseSetupArgs,
  planFileDownload,
  pythonCandidates,
  resolveLayout,
  resolveModelFile,
  totalModelBytes,
  type QwenManifest
} from '../../electron/workers/qwen/setupCore.mjs';

const manifest = JSON.parse(readFileSync('electron/workers/qwen/manifest.json', 'utf8')) as QwenManifest;

describe('установка Qwen3-TTS: пути (TASK-104, decision-64)', () => {
  it('каталог данных совпадает с тем, что использует приложение', () => {
    expect(defaultUserDataDir('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\project-hub'
    );
    expect(defaultUserDataDir('win32', {}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Roaming\\project-hub');
    expect(defaultUserDataDir('darwin', {}, '/Users/u')).toBe('/Users/u/Library/Application Support/project-hub');
    expect(defaultUserDataDir('linux', {}, '/home/u')).toBe('/home/u/.config/project-hub');
    expect(defaultUserDataDir('linux', { XDG_CONFIG_HOME: '/cfg' }, '/home/u')).toBe('/cfg/project-hub');
  });

  it('окружение лежит в qwen-tts, веса — в общем кэше моделей', () => {
    const layout = resolveLayout(path.join('data', 'app'));
    expect(layout.home).toBe(path.join('data', 'app', 'qwen-tts'));
    expect(layout.modelsDir).toBe(path.join('data', 'app', 'models', 'qwen-tts'));
    expect(layout.venvPython.startsWith(path.join(layout.home, 'venv'))).toBe(true);
    expect(layout.installManifest).toBe(path.join(layout.home, 'install.json'));
    expect(resolveLayout('x', { home: 'h', modelsDir: 'm' })).toMatchObject({ home: 'h', modelsDir: 'm' });
  });

  it('файл модели не может оказаться за пределами её каталога', () => {
    expect(resolveModelFile('models', 'speech_tokenizer/config.json')).toBe(
      path.join('models', 'speech_tokenizer', 'config.json')
    );
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\x', 'C:/x', 'a//b', './x', '', 'a\\..\\..\\x']) {
      expect(() => resolveModelFile('models', bad), bad).toThrow(/unsafe/);
    }
  });

  it('все пути манифеста проходят проверку', () => {
    for (const kind of ['custom', 'design', 'base']) {
      for (const file of manifest.models[kind].files) {
        expect(() => resolveModelFile('models', file.path)).not.toThrow();
      }
    }
  });
});

describe('установка Qwen3-TTS: адрес Hugging Face — параметр (decision-50 п. 5)', () => {
  it('пустой адрес — официальный хаб, хвостовой слэш отбрасывается', () => {
    expect(normalizeEndpoint('')).toBe('https://huggingface.co');
    expect(normalizeEndpoint(undefined)).toBe('https://huggingface.co');
    expect(normalizeEndpoint(' https://hf-mirror.com/ ')).toBe('https://hf-mirror.com');
    expect(normalizeEndpoint('http://192.168.1.11:8080/hf//')).toBe('http://192.168.1.11:8080/hf');
  });

  it('не URL и чужая схема отвергаются', () => {
    expect(() => normalizeEndpoint('hf-mirror.com')).toThrow(/invalid endpoint/);
    expect(() => normalizeEndpoint('file:///c:/models')).toThrow(/protocol/);
    expect(() => normalizeEndpoint('javascript:alert(1)')).toThrow(/protocol/);
  });

  it('файл берётся закреплённой ревизией', () => {
    const model = manifest.models.custom;
    expect(buildFileUrl('https://hf-mirror.com/', model.repo, model.revision, 'speech_tokenizer/model.safetensors')).toBe(
      `https://hf-mirror.com/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/resolve/${model.revision}/speech_tokenizer/model.safetensors`
    );
    expect(buildFileUrl('', 'a/b', 'rev', 'dir/file name.json')).toBe(
      'https://huggingface.co/a/b/resolve/rev/dir/file%20name.json'
    );
  });
});

describe('установка Qwen3-TTS: интерпретатор', () => {
  it('разбирает версию из вывода --version', () => {
    expect(parsePythonVersion('Python 3.11.15')).toEqual({ major: 3, minor: 11, patch: 15 });
    expect(parsePythonVersion('Python 3.13')).toEqual({ major: 3, minor: 13, patch: 0 });
    expect(parsePythonVersion('not python')).toBeNull();
    expect(parsePythonVersion(null)).toBeNull();
  });

  it('поддерживаются версии из диапазона манифеста', () => {
    const { pythonMin, pythonMax } = manifest.runtime;
    const supported = (v: string) => isSupportedPython(parsePythonVersion(v), pythonMin, pythonMax);
    expect(supported('3.10.0')).toBe(true);
    expect(supported('3.11.15')).toBe(true);
    expect(supported('3.13.5')).toBe(true);
    expect(supported('3.9.18')).toBe(false);
    expect(supported('3.14.0')).toBe(false);
    expect(supported('2.7.18')).toBe(false);
    expect(isSupportedPython(null, pythonMin, pythonMax)).toBe(false);
  });

  it('явно указанный интерпретатор пробуется первым, 3.11 — раньше остальных', () => {
    const win = pythonCandidates('win32', 'C:\\py\\python.exe');
    expect(win[0]).toEqual({ cmd: 'C:\\py\\python.exe', args: [] });
    expect(win[1]).toEqual({ cmd: 'py', args: ['-3.11'] });
    expect(win.at(-1)).toEqual({ cmd: 'python3', args: [] });
    expect(pythonCandidates('linux')[0]).toEqual({ cmd: 'python3.11', args: [] });
  });
});

describe('установка Qwen3-TTS: докачка весов', () => {
  it('целый файл не качается заново', () => {
    expect(planFileDownload(100, 100, undefined)).toEqual({ action: 'done', offset: 100 });
    expect(planFileDownload(100, 100, 40)).toEqual({ action: 'done', offset: 100 });
  });

  it('частичная загрузка продолжается с места обрыва', () => {
    expect(planFileDownload(100, undefined, 40)).toEqual({ action: 'resume', offset: 40 });
    expect(planFileDownload(100, undefined, 100)).toEqual({ action: 'verify', offset: 100 });
  });

  it('файл чужого размера и лишние байты — повод начать заново', () => {
    expect(planFileDownload(100, undefined, undefined)).toEqual({ action: 'restart', offset: 0 });
    expect(planFileDownload(100, 101, undefined)).toEqual({ action: 'restart', offset: 0 });
    expect(planFileDownload(100, undefined, 150)).toEqual({ action: 'restart', offset: 0 });
    expect(planFileDownload(100, undefined, 0)).toEqual({ action: 'restart', offset: 0 });
  });

  it('объём загрузки считается по выбранным моделям', () => {
    const custom = totalModelBytes(manifest, ['custom']);
    expect(custom).toBeGreaterThan(4_500_000_000);
    expect(totalModelBytes(manifest, ['custom', 'design'])).toBeGreaterThan(custom * 1.9);
    expect(totalModelBytes(manifest, ['custom', 'design', 'base'])).toBeGreaterThan(custom * 2.9);
    expect(totalModelBytes(manifest, [])).toBe(0);
  });
});

describe('установка Qwen3-TTS: аргументы командной строки', () => {
  it('без аргументов ставятся все модели', () => {
    expect(parseSetupArgs([])).toMatchObject({
      json: false,
      force: false,
      models: ['custom', 'design', 'base'],
      hfEndpoint: ''
    });
  });

  it('принимает обе формы записи значения', () => {
    expect(
      parseSetupArgs(['--json', '--models', 'design', '--hf-endpoint=https://hf-mirror.com', '--user-data', 'C:\\data'])
    ).toMatchObject({ json: true, models: ['design'], hfEndpoint: 'https://hf-mirror.com', userData: 'C:\\data' });
  });

  it('список моделей очищается от повторов, неизвестная модель — ошибка', () => {
    expect(parseModelKinds(' Custom , design,custom ')).toEqual(['custom', 'design']);
    expect(parseModelKinds('base')).toEqual(['base']);
    expect(() => parseModelKinds('clone')).toThrow(/unknown model kind/);
  });

  it('пропущенное значение и позиционный аргумент — ошибка, а не молчаливый пропуск', () => {
    expect(() => parseSetupArgs(['--models'])).toThrow(/missing value/);
    expect(() => parseSetupArgs(['custom'])).toThrow(/unexpected argument/);
  });
});

describe('зависимости сайдкара', () => {
  const requirements = readFileSync('electron/workers/qwen/requirements.txt', 'utf8');

  it('файл только из ASCII: pip читает его в кодировке локали', () => {
    // eslint-disable-next-line no-control-regex -- проверяется именно диапазон ASCII
    expect(/^[\x00-\x7f]*$/.test(requirements)).toBe(true);
  });

  it('все версии закреплены, torch ставится отдельно из своего индекса', () => {
    const lines = requirements.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) expect(line, line).toMatch(/^[A-Za-z0-9_.-]+==[A-Za-z0-9_.+!-]+$/);
    expect(lines.some((l) => /^torch(audio)?==/.test(l))).toBe(false);
    expect(lines).toContain('faster-qwen3-tts==0.4.0');
    expect(lines).toContain('transformers==5.15.1');
    expect(manifest.runtime.torchPackages.every((p) => p.includes('=='))).toBe(true);
  });
});
