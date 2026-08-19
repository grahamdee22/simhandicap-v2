# How to set up match play

This covers **Match Play** on the **Social** tab.

Important: despite the name, these challenges are **two-player net stroke play**. Both players enter gross scores, SimCap applies handicap strokes, and the lower total net score wins. Equal nets are a tie. This is not traditional hole-by-hole match play.

If you want a **group tournament Match Play bracket**, see [Create and run a tournament](./create-and-run-a-tournament.md). That is a separate feature.

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

### 2. Opponent (direct only)

Pick someone from your groups. You’ll see their index and which group they share with you.

If you don’t have group members yet, create or join a crew first.

Even though Match Play is described as challenging any SimCap golfer, the direct-challenge picker currently only lists people you already share a group with.

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
2. Optionally use filters for handicap range, course, and simulator platform.
3. Under **Open now**, tap a challenge for details.
4. Tap **Accept challenge**, then complete:
   - **Your tee**
   - **Settings screenshot**
   - **Confirm**
5. You’ll see a warning that you’ll join as player 2 and it can’t be undone.
6. Tap **Accept & start match**.

**Scheduled challenges** say **Coming soon — not yet open for acceptance**.

Important side effect: when someone accepts one of your open challenges, your other unclaimed open challenges can be cancelled automatically. The create flow lets you post up to three, but accepting one may clear the others.

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

## Notes / unclear behavior

- Social Match Play is net stroke play. Tournament Match Play is a different bracket feature and currently compares **gross** hole scores.
- Direct challenges currently require a shared group, even though the feature copy mentions any SimCap golfer.
- Scheduled “Later” challenges move toward go-live when the Match Play section on Social is loaded by a signed-in user. There may not be a fully independent always-on timer.
- If a required setup photo fails to upload after the challenge is created or accepted, the match can still exist. Recheck the challenge on Social if something looks incomplete.
- Accepting one open challenge can cancel the poster’s other open challenges.
- Profile **W–L–D** clearly updates for abandons/forfeits. Whether normal completed wins, losses, and draws always update that same record is not clearly reliable in the current implementation.
- **Save to index** uses today’s date and your current preferred logging platform; it may not preserve the exact platform chosen during the match.
- Release builds expect settings photos; some development builds can skip them. Don’t rely on skipping in normal use.
- Open-feed filters can hide challenges. If the feed looks empty, clear filters and try again.
