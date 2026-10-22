/**
 * Asserts the Spanish strings for the known i18n gaps we just fixed:
 * auth stack headers, ordinal places, and group tournament low-net lines.
 * Loads locale JSON directly (no React Native / i18next init).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import en from '../../i18n/locales/en.json' with { type: 'json' };
import es from '../../i18n/locales/es.json' with { type: 'json' };
import { formatOrdinalPlace } from '../formatOrdinal';

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

describe('Spanish i18n gaps (auth headers, ordinals, low net)', () => {
  it('auth stack headers are translated (not English leftovers)', () => {
    assert.equal(es.common.createAccount, 'Crear cuenta');
    assert.notEqual(es.common.createAccount, en.common.createAccount);

    assert.equal(es.auth.completeProfile.navTitle, 'Tu nombre');
    assert.notEqual(es.auth.completeProfile.navTitle, en.auth.completeProfile.navTitle);
    assert.equal(en.auth.completeProfile.navTitle, 'Your name');
  });

  it('ordinal helper produces Spanish forms used in league banners', () => {
    assert.equal(formatOrdinalPlace(1, 'es'), '1.º');
    assert.equal(formatOrdinalPlace(2, 'es'), '2.º');
    assert.equal(formatOrdinalPlace(3, 'es'), '3.º');
    // Banner interpolates {{place}} — must not be English 1st/2nd/3rd.
    assert.match(
      interpolate(es.log.round.leagueBanner, {
        leagueName: 'Torneo',
        place: formatOrdinalPlace(1, 'es'),
      }),
      /1\.º/
    );
    assert.doesNotMatch(
      interpolate(es.log.round.leagueBanner, {
        leagueName: 'Torneo',
        place: formatOrdinalPlace(1, 'es'),
      }),
      /\b1st\b/
    );
  });

  it('group tournament standing lines use Spanish low-net wording', () => {
    assert.match(es.tournaments.section.teamStandingLine, /neto más bajo/i);
    assert.doesNotMatch(es.tournaments.section.teamStandingLine, /low net/i);

    const line = interpolate(es.tournaments.section.teamStandingLine, {
      team: 'Azul',
      place: formatOrdinalPlace(2, 'es'),
      value: '54.0',
    });
    assert.equal(line, 'Azul · 2.º · neto más bajo 54.0');

    const partial = interpolate(es.tournaments.section.teamStandingLinePartial, {
      team: 'Azul',
      place: formatOrdinalPlace(2, 'es'),
      value: '54.0',
    });
    assert.match(partial, /parcial/i);
    assert.doesNotMatch(partial, /\bpartial\b/i);
  });
});
