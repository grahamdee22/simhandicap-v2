# SimCap

SimCap is a cross-platform simulator-golf handicap and competition app. It tracks simulator rounds, calculates a versioned SimCap index, and supports social groups, matches, and tournaments including stroke play, scramble, best ball, and match play.

The app runs on iOS, Android, and web with Expo Router. Authentication, persistence, realtime features, storage, database policies, and tournament RPCs are backed by Supabase.

## Technology

- Expo 54 and Expo Router
- React Native and React Native Web
- TypeScript in strict mode
- Zustand for client state
- Supabase Auth, Postgres, Realtime, Storage, Edge Functions, and RPCs

## Requirements

- Node.js 22 LTS
- npm
- A configured Supabase project for authenticated and cloud-backed features
- EAS CLI only when creating native builds or submitting to app stores

## Local setup

1. Install the locked dependencies:

   ```bash
   npm ci
   ```

2. Copy `.env.example` to `.env` and provide the public Supabase client values for the intended project:

   ```bash
   cp .env.example .env
   ```

3. Start Expo:

   ```bash
   npm start
   ```

Expo can then launch the app for web, iOS, or Android. Platform-specific shortcuts are also available:

```bash
npm run web
npm run ios
npm run android
```

Do not commit `.env`, service-role credentials, or other secrets.

## Quality checks

Run the same checks used by continuous integration:

```bash
npm run check
npm test
```

- `npm run check` runs the TypeScript compiler without emitting files.
- `npm test` runs the Node test suite through `tsx`.

Create a static web export with:

```bash
npm run export:web
```

## Test data

The repository contains test-data scripts for local or controlled Supabase environments:

```bash
npm run seed:test
npm run test:tournaments
```

These scripts write database records. Review their configuration and use a non-production environment unless a production test-data operation has been explicitly approved.

## Tournament documentation

Implementation notes for the tournament phases are in:

- [`docs/PHASE4_MATCH_PLAY_PAIRINGS.md`](docs/PHASE4_MATCH_PLAY_PAIRINGS.md)
- [`docs/PHASE5_SCRAMBLE.md`](docs/PHASE5_SCRAMBLE.md)
- [`docs/PHASE6_BEST_BALL.md`](docs/PHASE6_BEST_BALL.md)
- [`docs/PHASE7_POLISH.md`](docs/PHASE7_POLISH.md)

Supabase schema and policy history lives in [`supabase/migrations`](supabase/migrations).

## Versioning and releases

The user-facing Expo app version is maintained in [`app.json`](app.json). The `package.json` version is the npm package metadata and is not currently the app release version.

Native builds use the EAS profiles in [`eas.json`](eas.json). Web builds use Expo's static export and the deployment configuration committed to the repository.

## Contributing

Work from a dedicated branch and open a pull request against `main`. Run the typecheck and tests before requesting review.

Changes must be reviewed and approved by Graham (`@grahamdee22`) before they are merged into `main`. Do not push implementation work directly to `main` or enable auto-merge without his approval.
