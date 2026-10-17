/**
 * Translated-locale feature gate (es/ko inert until reviewed).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirrors SUPPORTED_LANGUAGES filtering in src/i18n/index.ts so we can assert
 * the gate without loading React Native / expo-localization.
 */
function availableLanguages(
  all: ReadonlyArray<{ code: string; label: string }>,
  translatedEnabled: boolean
): ReadonlyArray<{ code: string; label: string }> {
  return translatedEnabled ? all : all.filter((l) => l.code === 'en');
}

function resolveDeviceLanguage(
  deviceCode: string | null | undefined,
  enabledCodes: ReadonlySet<string>
): string {
  const code = deviceCode ?? 'en';
  return enabledCodes.has(code) ? code : 'en';
}

const ALL = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ko', label: '한국어' },
] as const;

describe('translated language availability', () => {
  it('flag off: only English is available (picker + auto-detect)', () => {
    const available = availableLanguages(ALL, false);
    assert.deepEqual(
      available.map((l) => l.code),
      ['en']
    );
    const enabled = new Set(available.map((l) => l.code));
    assert.equal(resolveDeviceLanguage('es', enabled), 'en');
    assert.equal(resolveDeviceLanguage('ko', enabled), 'en');
    assert.equal(resolveDeviceLanguage('en', enabled), 'en');
    assert.equal(resolveDeviceLanguage(null, enabled), 'en');
  });

  it('flag on: es and ko are available and auto-detect', () => {
    const available = availableLanguages(ALL, true);
    assert.deepEqual(
      available.map((l) => l.code),
      ['en', 'es', 'ko']
    );
    const enabled = new Set(available.map((l) => l.code));
    assert.equal(resolveDeviceLanguage('es', enabled), 'es');
    assert.equal(resolveDeviceLanguage('ko', enabled), 'ko');
  });
});
