# How to set up match play

This covers **Match Play** on the **Social** tab.

Important: despite the name, these challenges are **two-player net stroke play**. Both players enter gross scores, SimCap applies handicap strokes, and the lower total net score wins. Equal nets are a tie. This is not traditional hole-by-hole match play.

If you want a **group tournament Match Play bracket**, see [Create and run a tournament](./create-and-run-a-tournament.md). That feature is separate and currently decides holes with **gross** hole scores, not Social-style net stroke totals.

## Where to start

1. Open the **Social** tab.
2. At the top, find **Match Play**.
3. Tap **Create Match**.

The info text says you can challenge any SimCap golfer to a head-to-head stroke play match from any simulator, with net scores from your SimCap index and tee.

You’ll also see:

- **Incoming & active** — direct challenges and rounds in progress
- **Open challenge feed** — challenges anyone can accept (**Open now** and **Scheduled challenges**)
- **Recent matches** — finished or abandoned matches

From **Profile**, if match-record data loads, you may also see **Match play record** (`W–L–D · stroke matches on SimCap`) and open **Match history**.

## Create a challenge

The create flow is a multi-step wizard. Step titles are:

1. **Challenge type**
2. **Opponent** (direct only)
3. **Sim, course & tee**
4. **Sim settings**
5. **Holes**
6. **Sim setup photo**
7. **Schedule go-live time** (future open challenges only)
8. **Review & send**

### 1. Challenge type

Choose who can join:

- **Direct challenge** — pick a crewmate from your groups. They accept privately on Social.
- **Open challenge** — post to the SimCap feed. Any signed-in player can review details and accept.

For open challenges, also choose:

- **Now** — goes live after you post (with setup photo)
- **Later** — schedule a go-live time (from now through **30 days**). When it goes live, you’ll upload your setup photo before it appears in the active feed.

**Scheduled “Later” promotion:** due scheduled challenges are promoted by the `process_future_open_challenges` RPC, which runs when a signed-in user loads the Match Play hub on Social (and via a dev-only manual trigger). There is no separate always-on server cron in the app code — progress depends on someone hitting that path after `scheduled_for`.

### 2. Opponent (direct only)

Pick someone from your groups. You’ll see their index and which group they share with you.

If you don’t have group members yet, create or join a crew first.

Even though Match Play copy mentions challenging any SimCap golfer, the **direct-challenge picker only lists people you already share a group with**. Open challenges are the path for non-crew opponents.

Limits that can block sending:

- Up to **3** open challenges posted at once
- Up to **3** pending/active/waiting direct challenges
- Only one pending/active/waiting direct match with the same opponent

### 3. Sim, course & tee

Set:

- **Sim platform** — Trackman, Foresight, Full Swing, E6, GSPro, or Garmin
- **Course** — searchable catalog list
- **Tee** — or **Custom** with **Course rating** and **Slope**

Defaults when you open Create Match include Pebble Beach and White tee, plus your preferred logging platform.

This is your side of the match setup. The opponent chooses their own tee when they accept.

### 4. Sim settings

Choose the same condition labels used when logging a round:

- **Putting mode** — Auto / 2-putt · Gimme / &lt;5ft · Putt / Everything
- **Pin placement** — GSPro: Thu–Sun; other platforms: Easy / Medium / Hard
- **Wind** — Off / Calm · Light / Breeze · Strong / Heavy
- **Mulligans** — None · 1 · 2 · 3+

The opponent cannot change these conditions later.

### 5. Holes

Choose:

- **18 holes** — Full round
- **Front 9** — Holes 1–9
- **Back 9** — Holes 10–18

Optional: turn on **Require scorecard verification**.

> Both players upload a final scorecard screenshot; AI confirms scores match before the match completes.

### 6. Sim setup photo

Take or choose a photo of your sim’s settings screen so your opponent can see putting mode, pins, wind, and mulligans. The app says both players use the honor system for conditions.

Tap **Choose photo** (or **Change photo**).

Future open challenges skip this until go-live time.

Release builds require a settings photo for create/accept flows that need one. **Development builds** can skip the screenshot (`ALLOW_SKIP_SETTINGS_SCREENSHOT = __DEV__`). Don’t rely on skipping in normal use.

**Upload failure:** the match row is inserted **before** the photo upload. If upload fails after create/accept, the challenge can still exist without a photo URL; the UI alerts you and returns to Social. Recheck the challenge if something looks incomplete.

### 7. Review & send

Review opponent/visibility, course, tee, holes, and conditions, then tap:

- **Send challenge** (direct)
- **Post open challenge** (open / now)
- **Schedule future challenge** (open / later)

## Accept a direct challenge

1. On Social, find the challenge under **Incoming & active**.
2. Tap **Accept**, or **Decline**.
3. If accepting, walk through:
   - **Challenge details** — course, holes, challenger’s tee/conditions/photo
   - **Your tee** — and sim platform
   - **Settings screenshot**
   - **Confirm**
4. Tap **Accept & start match**.

You keep the posted conditions and holes; you only choose your own tee/platform and setup photo.

## Accept an open challenge

1. Open **Open challenge feed**.
2. Optionally use filters for handicap range, course, and simulator platform. Filters are client-side; an empty feed often means filters are hiding rows — clear them and try again.
3. Under **Open now**, tap a challenge for details.
4. Tap **Accept challenge**, then complete:
   - **Your tee**
   - **Settings screenshot**
   - **Confirm**
5. You’ll see a warning that you’ll join as player 2 and it can’t be undone.
6. Tap **Accept & start match**.

**Scheduled challenges** say **Coming soon — not yet open for acceptance**.

**Side effect:** when someone successfully accepts one of your open challenges, `accept_open_challenge` deletes your other unclaimed open challenges in the same transaction. The create flow lets you post up to three, but accepting one clears the others.

## Play and finish the match

Active matches show **Tap to enter scores** and open **Live scoring**.

On the scoring screen you can:

- Enter each hole’s gross score (UI range 1–15)
- See net scores after handicap strokes
- View both players’ settings photos
- Use **Match chat**
- React to an opponent’s posted score with one locked reaction
- **Abandon match** — confirmation says you record a loss and forfeit; your opponent’s match record does not change

### How net scoring works here

At scoring time, SimCap uses each player’s **current** profile index (not only the index shown when the challenge was posted), plus each player’s tee rating/slope and the holes being played:

1. Convert index into a course handicap.
2. Give the difference in strokes to the higher-handicap player.
3. Apply those strokes by hole stroke index.
4. Net = gross minus strokes received.

Putting / pin / wind / mulligan difficulty modifiers from round logging are **not** applied again in match scoring.

### Completing the match

The match finishes when both players have entered every required hole, and — if verification was required — both scorecards are verified.

Results show winner or tie, gross and net totals, hole-by-hole scores, and **Rematch**.

You may also see **Save this round to your SimCap index?** with **Skip** or **Save to index**.

**Save to index** builds a normal logged round using **today’s date** and your **current preferred logging platform** from Profile — not the match’s played conditions date, and not necessarily the platform chosen for the match. Review before saving if that matters for your index.

### Profile W–L–D

Profile **match_wins / match_losses / match_draws** are only updated by the **abandon** path today: abandon increments the abandoner’s `match_losses` and `match_forfeits`. No client or RPC path increments `match_wins` or `match_draws` when a match completes normally. Treat the Profile W–L–D line as reliable for forfeits/abandons, not as a full completed-match record.
