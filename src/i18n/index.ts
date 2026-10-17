import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { TRANSLATED_LANGUAGES_ENABLED } from '@/src/lib/featureFlags';
import en from './locales/en.json';
import es from './locales/es.json';
import ko from './locales/ko.json';

/** Full catalog of locale files in the repo (may include unreviewed drafts). */
const ALL_SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ko', label: '한국어' },
] as const;

export type AppLanguageCode = (typeof ALL_SUPPORTED_LANGUAGES)[number]['code'];

/**
 * Languages exposed to users (picker + device auto-detect).
 * When TRANSLATED_LANGUAGES_ENABLED is off, English only — es/ko stay in the catalog above but inert.
 */
export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: AppLanguageCode; label: string }> =
  TRANSLATED_LANGUAGES_ENABLED
    ? ALL_SUPPORTED_LANGUAGES
    : ALL_SUPPORTED_LANGUAGES.filter((l) => l.code === 'en');

export const LANGUAGE_OVERRIDE_KEY = '@simcap/language_override';

const ENABLED_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));

function isSupportedLanguage(code: string | null | undefined): code is AppLanguageCode {
  return !!code && ENABLED_CODES.has(code);
}

/** Device preferred language code, or English if unsupported / unavailable / translations gated off. */
export function deviceLanguageCode(): AppLanguageCode {
  // On web during static export / non-DOM, getLocales() can be []. Guard and fall back.
  const code = Localization.getLocales()[0]?.languageCode ?? 'en';
  return isSupportedLanguage(code) ? code : 'en';
}

export async function getLanguageOverride(): Promise<AppLanguageCode | null> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_OVERRIDE_KEY);
    return isSupportedLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Persist a manual language choice (or clear with null to follow the device).
 * Takes priority over auto-detected locale while set.
 */
export async function setLanguageOverride(code: AppLanguageCode | null): Promise<void> {
  try {
    if (code == null) {
      await AsyncStorage.removeItem(LANGUAGE_OVERRIDE_KEY);
      await i18n.changeLanguage(deviceLanguageCode());
      return;
    }
    if (!isSupportedLanguage(code)) return;
    await AsyncStorage.setItem(LANGUAGE_OVERRIDE_KEY, code);
    await i18n.changeLanguage(code);
  } catch {
    // Keep current language if storage fails.
  }
}

async function resolveInitialLanguage(): Promise<AppLanguageCode> {
  const override = await getLanguageOverride();
  return override ?? deviceLanguageCode();
}

const resources = {
  en: { translation: en },
  es: { translation: es },
  ko: { translation: ko },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguageCode(),
  fallbackLng: 'en',
  compatibilityJSON: 'v4',
  interpolation: {
    // React Native already escapes; i18next must not double-escape.
    escapeValue: false,
  },
  // RN / Expo: avoid Suspense-on-translate (default true). Keeps screens rendering
  // with a ready flag instead of throwing mid-tree during init / language changes.
  react: {
    useSuspense: false,
  },
});

// Hydrate AsyncStorage override after first paint (override wins over device).
void resolveInitialLanguage().then((lng) => {
  if (lng !== i18n.language) {
    void i18n.changeLanguage(lng);
  }
});

export { useTranslation } from 'react-i18next';
export default i18n;
