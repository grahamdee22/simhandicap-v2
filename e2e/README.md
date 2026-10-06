# Playwright smoke tests (web preview only)

These tests run against the deployed preview at **https://app.sim-cap.com**, not a local server.

They are **not** a replacement for TestFlight or native checks. React Native Web does not perfectly mirror native rendering or native dialog behavior — this suite only gives confidence about the web layer.

```bash
npm run test:e2e
```

Uses seeded accounts from `scripts/seed-test-data.js` (e.g. `walter-white@seed.simcap.test`).
