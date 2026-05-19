# Phase 7 — Cross-cutting polish

**Status:** Implemented  
**PRD:** SimCap Formats PRD v1

## Delivered

| Item | Location |
|------|----------|
| Format picker copy (§1.3) | `src/lib/tournamentFormatCopy.ts` → `league-create` |
| All formats enabled | No `comingSoon` on create or log opt-in |
| Team formats need 4+ members | `league-create` format step |
| Social tournaments info | `groups.tsx` section copy |
| `logOptInDisabled` removed | `leagues.ts` |
| Unit tests | `src/lib/__tests__/tournamentScoring.test.ts` |
| App version | `2.12.0` |

## Test

```bash
npm test
```

Uses Node’s built-in test runner via `tsx`.
