# Playwright smoke tests (web preview only)

These tests run against the deployed preview at **https://app.sim-cap.com**, not a local server.

They are **not** a replacement for TestFlight or native checks. React Native Web does not perfectly mirror native rendering or native dialog behavior — this suite only gives confidence about the web layer.

```bash
npm run test:e2e
```

Uses seeded accounts from `scripts/seed-test-data.js`:

| Account | Email | Password | Role |
| --- | --- | --- | --- |
| Walter White | `walter-white@seed.simcap.test` | `Seed-847291!` | Non-admin (default) |
| SimCap Admin Seed | `simcap-admin-seed@seed.simcap.test` | `Seed-999001!` | `profiles.is_app_admin = true` |

Ensure the admin seed exists (and migration `088_simcap_app_admin.sql` is applied) before running admin-gate tests:

```bash
npm run seed:test
```

That always calls `ensureAdminSeedProfile()` even without `FULL_SEED=1`.

Platform dropdown coverage: `platform-dropdown-new-sims.spec.ts` asserts Muni Golf, Shot Forge,
Pure Play, and Foresight Premier+ appear as selectable options on Log a Round.

### Group Challenges

Specs: `group-challenge-lifecycle.spec.ts`, `groups-tab-tournament-cache.spec.ts`.

Seed the dual QA crews (and add Walter White as dual admin) before running:

```bash
npm run seed:group-challenge-qa
```

| Group | Notes |
| --- | --- |
| QA Group Challenge A / B | `is_test` crews with 5 companions each |
| Dual admins | Graham (manual QA) + Walter White (Playwright) |

**Documented gap:** Verified-mode screenshot upload + admin approval is not automated (file picker). The Verified wizard asserts mode copy / review summary only.
