# Phase 6 — Best Ball tournaments

**Status:** Implemented  
**PRD refs:** §4 (Best Ball), §5.5 (rounds count toward index), §6.3 (real-time team merge, partial standings)

## Scope

- Enable **Best Ball** on tournament create (teams required; no even-count rule; no designated scorer)
- Each teammate **logs own round** + **own 18 hole grosses**
- `calculate-team-hole-scores` merges **min gross per hole** into `tournament_team_hole_scores` with `is_partial` until all teammates have submitted for that `round_date`
- Standings use **complete** team round totals from hole aggregation (not individual `league_rounds` nets)
- **Partial** indicator on standings / social card when a team has incomplete teammate submissions
- Rounds **count toward SimCap index** (unlike Scramble)

## Server fix

- Best-ball member list comes from `league_entries` (not `league_team_members`, which does not exist)

## Related

- Phase 5: Scramble (designated scorer, even teams, index exclusion)
- Phase 7: format copy polish and tests (complete)
