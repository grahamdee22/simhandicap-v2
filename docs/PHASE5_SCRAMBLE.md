# Phase 5 — Scramble tournaments

**Status:** Implemented  
**PRD refs:** §3 (Scramble), §5.5 (index exclusion), §6.2 (designated scorer), §6.6 (even team sizes)

## Scope

- Enable **Scramble** on tournament create (teams required)
- **Designated scorer** per team — only they can opt in at log time and submit hole scores
- **Even team sizes** (2, 4, 6…) validated at launch
- Optional **scramble handicap override** on `leagues.scramble_handicap_override`
- Team **gross per hole** (`is_team_score: true`) → `calculate-team-hole-scores` → `tournament_team_hole_scores`
- Standings: team rows with member names; avg net from designated-scorer `league_rounds`
- Scramble rounds **excluded from SimCap index** when no stroke/best-ball tournament is also opted in

## Out of scope (v1)

- 9-hole scramble rounds (blocked at log via 18-hole gate)
- Odd team sizes (blocked at create)
- Full 15%/85% team handicap UI (helper in `scrambleTournament.ts` for future display)

## Related

- Phase 1: `tournament_team_hole_scores`, `designated_scorer_id`, edge `calculate-team-hole-scores`
- Phase 3: `tournament-holes` screen, designated-scorer gate
- Phase 6: Best Ball (separate enablement)
