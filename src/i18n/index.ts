import { en } from './en';
import { ru } from './ru';
import type { Language, TranslationDictionary } from './types';

export * from './types';
export * from './useTranslation';
export { useTranslation as useI18n } from './useTranslation';

export const dictionaries: Record<Language, TranslationDictionary> = {
  en,
  ru
};

export function getDictionary(lang: Language): TranslationDictionary {
  return dictionaries[lang] || dictionaries.en;
}
