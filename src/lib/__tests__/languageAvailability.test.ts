/**
 * Translated-locale feature gate (per-locale enablement).
 * Mirrors SUPPORTED_LANGUAGES filtering in src/i18n/index.ts without loading RN.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function availableLanguages(
  all: ReadonlyArray<{ code: string; label: string }>,
  enabledTranslated: readonly string[]
): ReadonlyArray<{ code: string; label: string }> {
  const enabled = new Set(enabledTranslated.map((c) => c.toLowerCase()));
  return all.filter((l) => l.code === 'en' || enabled.has(l.code));
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
  it('empty enable list: only English (picker + auto-detect)', () => {
    const available = availableLanguages(ALL, []);
    assert.deepEqual(
      available.map((l) => l.code),
      ['en']
    );
    const enabled = new Set(available.map((l) => l.code));
    assert.equal(resolveDeviceLanguage('es', enabled), 'en');
    assert.equal(resolveDeviceLanguage('ko', enabled), 'en');
    assert.equal(resolveDeviceLanguage('en', enabled), 'en');
  });

  it('Spanish only: es available, Korean stays inert', () => {
    const available = availableLanguages(ALL, ['es']);
    assert.deepEqual(
      available.map((l) => l.code),
      ['en', 'es']
    );
    const enabled = new Set(available.map((l) => l.code));
    assert.equal(resolveDeviceLanguage('es', enabled), 'es');
    assert.equal(resolveDeviceLanguage('ko', enabled), 'en');
  });

  it('es + ko: both available and auto-detect', () => {
    const available = availableLanguages(ALL, ['es', 'ko']);
    assert.deepEqual(
      available.map((l) => l.code),
      ['en', 'es', 'ko']
    );
    const enabled = new Set(available.map((l) => l.code));
    assert.equal(resolveDeviceLanguage('es', enabled), 'es');
    assert.equal(resolveDeviceLanguage('ko', enabled), 'ko');
  });
});
