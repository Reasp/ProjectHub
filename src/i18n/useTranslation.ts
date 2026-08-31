import { useProjectStore } from '../store/useProjectStore';
import { getDictionary } from './index';
import type { Language, TranslationDictionary } from './types';

export function useTranslation(): {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationDictionary;
} {
  const language = useProjectStore((state) => state.language);
  const setLanguage = useProjectStore((state) => state.setLanguage);
  const t = getDictionary(language);

  return { language, setLanguage, t };
}
