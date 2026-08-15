# SimCap Share Card — Claude / Cursor Handoff

## Goal
Build an in-app **shareable post-round card** for SimCap that matches the current app UX much more closely than the earlier concept work.

This feature should generate a **vertical 9:16 share card (1080x1920)** suitable for Instagram Story, text, and social sharing after a user logs or reviews a round.

Use the attached image `simcap_round_complete_share_card_reference.png` as the **primary visual reference** for hierarchy, spacing, tone, and composition.

## Primary Design Direction
This should feel like an extension of the existing SimCap product UI, not a separate marketing graphic.

### Match the app UX
Reference the existing app patterns visible in SimCap:
- deep green header / hero area
- soft mint / green accents
- large white type for primary values
- clean rounded cards
- simple iconography
- minimal, modern, calm, product-led visual language

### Overall vibe
- product-native
- premium but not flashy
- clean and shareable
- social-ready
- not corporate
- not overly gamified

## Card Layout (top to bottom)

### 1. Header / brand area
Include:
- SimCap logo lockup near top
- optional small robot mark if already available in product assets
- label: `ROUND COMPLETE`

### 2. Hero score block
Main visual priority should be the round score.
Example from reference:
- big hero number: `77`
- small pill under it: `+7`
- caption under pill: `OVER PAR`

This section should be visually dominant.

### 3. Course + metadata
Show:
- course name: `Royal Birkdale Golf Club`
- sim platform: `GSPro`
- date: `Jul 24, 2026`
- tee / setup label: `White`

This should visually resemble the current round detail structure.

## 4. Stat summary row
Use two summary tiles or a split card:
- `Differential` → `6.5`
- `Index after` → `2.0`

Optional helper text underneath each stat, matching current product tone:
- `Outside best 8 / 20`
- `0.0 this round`

## 5. Conditions played block
Include a white or very light card area with 4 small rounded cells:
- Putting mode → `Auto 2-putt`
- Pin placement → `Thursday · R1`
- Wind → `Off`
- Mulligans → `No mulligans`

Use simple, subtle icons if convenient.

## 6. Footer confirmation / provenance
Bottom section should communicate that the round was recorded in SimCap.
Example:
- `Logged in SimCap`
- secondary line: `Every round. Every sim.`

This can appear as a subtle green footer chip or status bar.

## Data Model
Suggested render input:

```ts
interface ShareRoundCardData {
  playerName?: string;
  score: number;              // e.g. 77
  scoreToPar: number;         // e.g. +7
  scoreToParLabel?: string;   // "OVER PAR", "EVEN PAR", "UNDER PAR"
  courseName: string;         // "Royal Birkdale Golf Club"
  simName: string;            // "GSPro"
  dateLabel: string;          // "Jul 24, 2026"
  teeLabel?: string;          // "White"
  differential: number;       // 6.5
  indexAfter: number;         // 2.0
  differentialSubtext?: string;
  indexAfterSubtext?: string;
  puttingMode?: string;       // "Auto 2-putt"
  pinPlacement?: string;      // "Thursday · R1"
  wind?: string;              // "Off"
  mulligans?: string;         // "No mulligans"
}
```

## Implementation Notes
- Output target: **1080 x 1920**.
- Prefer a component-based layout that can be rendered to image.
- Can be built in React / React Native / Expo using a sharable view, screenshot/export flow, or server-side render.
- Preserve generous spacing and clear type hierarchy.
- Keep line lengths short and avoid overcrowding.
- Course names may be long — support wrapping gracefully.
- Handle 1–3 digit scores safely.
- Handle positive / zero / negative score-to-par styling.

## Important Constraints
- Do **not** hardcode the demo values.
- Use **real SimCap brand assets** from the codebase instead of recreating the logo from scratch.
- Keep the design close to the real product UI.
- The attached reference is the strongest direction — use it as the visual anchor.

## Nice Future Variants
Once this base card works, it can expand into:
- New handicap index card
- Personal best card
- Challenge win card
- Tournament result card
- Match result card

