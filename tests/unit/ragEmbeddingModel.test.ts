import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  resolveEmbeddingModel
} from '../../electron/services/ragEmbeddingModel';

describe('resolveEmbeddingModel', () => {
  it('пустой/битый meta.json даёт многоязычную модель по умолчанию', () => {
    for (const meta of [null, undefined, {}, 'not-an-object', 42]) {
      expect(resolveEmbeddingModel(meta)).toEqual({
        id: DEFAULT_EMBEDDING_MODEL_ID,
        dtype: 'q8',
        queryPrefix: 'query: '
      });
    }
  });

  it('модель из meta.json определяет dtype и префикс запроса', () => {
    expect(resolveEmbeddingModel({ model: 'Xenova/all-MiniLM-L6-v2' })).toEqual({
      id: 'Xenova/all-MiniLM-L6-v2',
      dtype: 'fp32',
      queryPrefix: ''
    });
  });

  it('явный queryPrefix из meta.json важнее значения из реестра', () => {
    expect(resolveEmbeddingModel({ model: DEFAULT_EMBEDDING_MODEL_ID, queryPrefix: '' })).toEqual({
      id: DEFAULT_EMBEDDING_MODEL_ID,
      dtype: 'q8',
      queryPrefix: ''
    });
    expect(resolveEmbeddingModel({ model: 'Xenova/all-MiniLM-L6-v2', queryPrefix: 'passage: ' }).queryPrefix).toBe(
      'passage: '
    );
  });

  it('незнакомая модель считается несжатой и без префикса', () => {
    expect(resolveEmbeddingModel({ model: 'custom/my-embedder' })).toEqual({
      id: 'custom/my-embedder',
      dtype: 'fp32',
      queryPrefix: ''
    });
  });

  it('нестроковые и пустые значения полей игнорируются', () => {
    expect(resolveEmbeddingModel({ model: '   ', queryPrefix: 123 }).id).toBe(DEFAULT_EMBEDDING_MODEL_ID);
    expect(resolveEmbeddingModel({ model: 42 }).id).toBe(DEFAULT_EMBEDDING_MODEL_ID);
    expect(resolveEmbeddingModel({ model: DEFAULT_EMBEDDING_MODEL_ID, queryPrefix: null }).queryPrefix).toBe('query: ');
  });
});
