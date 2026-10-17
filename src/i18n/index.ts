import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

/** Languages with translation files. Add entries here as locales land. */
export const SUPPORTED_LANGUAGES = [{ code: 'en', label: 'English' }] as const;

export type AppLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const LANGUAGE_OVERRIDE_KEY = '@simcap/language_override';

const SUPPORTED_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));

function isSupportedLanguage(code: string | null | undefined): code is AppLanguageCode {
  return !!code && SUPPORTED_CODES.has(code);
}

/** Device preferred language code, or English if unsupported / unavailable. */
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
});

// Hydrate AsyncStorage override after first paint (override wins over device).
void resolveInitialLanguage().then((lng) => {
  if (lng !== i18n.language) {
    void i18n.changeLanguage(lng);
  }
});

export { useTranslation } from 'react-i18next';
export default i18n;
