# moderator-toolbox

A modular Reddit moderation-assistance app for [r/LLMPhysics](https://reddit.com/r/LLMPhysics), built on [Devvit](https://developers.reddit.com/docs) 0.15.6 from [devvit-app-template](https://github.com/AllHailSeizure/devvit-app-template).

**Version:** 0.0.4 (the Devvit App Store version last published from Reddit-Devvit; this repo has not published yet)

> **Cutover pending.** Predatory Journal Watch and the `!define` command were removed from this app and now live in [predatory-journal-watch](https://github.com/AllHailSeizure/predatory-journal-watch) and [define-bot](https://github.com/AllHailSeizure/define-bot). Read [CUTOVER.md](CUTOVER.md) before publishing the slimmed toolbox (suggested 0.1.0), or the subreddit will lose those features until the new apps are installed.

---

## Overview

`moderator-toolbox` enforces posting rules (flood quota, post length, nonresponder warnings), keeps comment chains in check (depth cap, self-replies), transfers flair milestones, ignores reports on bot comments, and gives moderators menu tools (Chain Mop, Saved Responses, Flood Quota Checker).

Each capability is a self-contained file. Trigger modules export `run(event)` and are listed in arrays in `src/server/registry.ts`; `dispatch()` runs each in a try/catch so one failing module does not stop the others. Action modules export `register(app)` and mount their own `/internal/menu/*` and `/internal/forms/*` routes. All settings are Devvit install settings declared in `devvit.json`.

Data: Redis (per-install) holds dedupe keys, flood post tracking, flair-transfer progress, saved responses and capped module logs. When `supabaseUrl` and `supabaseServiceKey` are set, log lines are also written to the Supabase `bot_logs` table. See [docs/privacy.md](docs/privacy.md).

```
src/server/
├── index.ts / app.ts                Entry point; Hono app
├── registry.ts                      Registers all modules
├── types.ts                         Shared types
├── trigger-modules/                 flood, depth-cap, self-response, nonresponder-check,
│                                    length, report, flair-transfer
├── action-modules/                  mop-tool, response-tool, quota-viewer
├── helpers/                         logger, signature, redis-helper (flood tracking)
└── test-harness/                    FakeRedditWorld + ScenarioRunner
```

---

## Trigger Modules

### Nonresponder Check

On post submit, checks the author's latest 2 qualifying previous posts here, within their 50 most recent posts across Reddit. Each needs at least 3 surviving comments from other known users: OP, the app account, missing/deleted authors, and removed/deleted/spam comments are excluded. Reddit's total comment count is only a cheap pre-filter. Removed, spam, and deleted posts are skipped; at most 10 candidate trees are fetched newest-first to find enough qualifying posts.

An OP response must be a surviving, non-spam reply to another eligible user's comment, at any depth. Top-level OP comments and replies to self or app accounts do not count. A removed/deleted parent still counts if its eligible author is known; missing parents and unknown/deleted parent authors do not. If no qualifying post has an OP response, the app posts a distinguished, stickied, locked warning on the new post with `botSignature`. Warnings have no repeat limit; the post stays open.

When every checked qualifying post was also warned, the app additionally reports the new post to moderators after posting its warning, with reason “Nonresponder: repeated warnings ignored”. `nonresponderReportRepeat` can disable reporting. Warning comment IDs are stored in `bot:nrmod:warned:{postId}` for 180 days. Without a tracking key, a distinguished comment by the app account starting with the current warning text counts as a previous warning. Changing that text or losing/removing older comments can prevent fallback detection after expiry. Report failures are logged; `bot:nrmod:log` records whether escalation was requested and reporting succeeded.

Moderators are exempt by default (`nonresponderRunOnMods=false`); approved users are checked by default (`nonresponderRunOnApprovedUsers=true`). For a moderator who is also approved, the moderator setting wins. Always skip missing/deleted posters and the app's own account; it is also excluded from other-user counts, reply parents, and used for warning detection. Other bots/apps are checked like anyone else, with exemptions only through moderator/approved status; there is no username list.

With `nonresponderSkipLockedComments=true` (default), locked comments (including AutoModerator, mod notices, or bots/apps) do not count toward the minimum, and OP replies to locked parents do not count as responses. Unlocked moderator comments count normally. A lock on OP's own reply does not matter: it counts if the reply survives and its parent is eligible. Turning this off lets locked comments and replies to them count, except app authors remain excluded.

Missing app identity, insufficient history, API failures, and incomplete comment scans produce no warning. Each tree is limited to 500 comments and 50 listings; hitting either limit skips enforcement. A seven-day atomic Redis claim prevents duplicate warning submissions within that window.

Settings are in the app installation settings (`devvit.json` → `settings.subreddit`):

| Key | Default |
|-----|---------|
| `nonresponderModEnabled` | `true` |
| `nonresponderPostsToCheck` | `2` (1–10) |
| `nonresponderMinComments` | `3` (1–100), other-user comments only |
| `nonresponderReportRepeat` | `true` |
| `nonresponderSkipLockedComments` | `true` |
| `nonresponderRunOnMods` | `false` |
| `nonresponderRunOnApprovedUsers` | `true` |
| `nonresponderResponse` | Responding to commenters is a subreddit rule. You did not respond on your recent qualifying posts. Please engage with the comments on this post by replying to commenters. |


Invalid numeric thresholds use defaults. A blank warning suppresses posting. Live testing should verify nested replies, removed/deleted comments, exemption settings, duplicate delivery, warning locking/stickying, report delivery, and warning tracking/fallback. Local decision tests: `npm test` (from `moderator-toolbox/`).

### Flood Moderator

**File:** `src/server/trigger-modules/flood-moderator.ts`  
**Triggers:** `onPostSubmit`, `onModAction`, `onPostDelete`

Enforces a per-user post quota using a rolling time window. When a user submits a post that exceeds their quota, the bot removes it and optionally posts a distinguished, stickied removal comment.

Every post is tracked in Redis regardless of whether enforcement fires. This tracking data is shared with the Quota Viewer and the bingo app.

**Removal logic:**
1. On `onPostSubmit`, the post is tracked in Redis and the user's mod/contributor status is stored
2. The quota is evaluated using the user's recent posts in the window; bot-removed, mod-removed, deleted, or exempt users can be excluded
3. If quota is exceeded, the post is removed and a comment is posted
4. `onModAction` updates the hash flag when a mod removes a post (`isModRemoved`)
5. `onPostDelete` updates the hash flag when the author deletes a post (`isUserDeleted`)

**Redis keys:**
- `flood:post:{postId}` — Hash: `userId`, `createdAt`, `isModerator`, `isApprovedUser`, `isUserDeleted`, `isModRemoved`, `isAutoRemoved`
- `flood:posts` — Global sorted set, score = creation timestamp
- `bot:flood:handled:{postId}` — Dedup key, TTL 1 hour

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `floodModEnabled` | `true` | Enable/disable (tracking still runs when disabled) |
| `floodAssistantMaxPosts` | `1` | Max posts per window |
| `floodAssistantWindowHours` | `24` | Rolling window in hours |
| `floodAssistantIgnoreModerators` | `true` | Exempt moderators from quota |
| `floodAssistantIgnoreContributors` | `true` | Exempt approved submitters from quota |
| `floodAssistantIgnoreAutoRemoved` | `true` | Don't count bot-removed posts |
| `floodAssistantIgnoreRemoved` | `true` | Don't count mod-removed posts |
| `floodAssistantIgnoreDeleted` | `true` | Don't count user-deleted posts |
| `floodAssistantResponse` | `''` | Removal comment text (leave blank for silent removal) |

---

### Depth Cap Moderator

**File:** `src/server/trigger-modules/depth-cap-moderator.ts`  
**Trigger:** `onCommentCreate`

Locks comment chains that reach the configured maximum depth. When a comment at the depth cap is created, the bot replies with a notice (distinguished and locked), locks the triggering comment, and files a report on it.

Depth is measured by walking `parentId` links upward until a post ID (`t3_`) is found. A comment directly on a post is depth 1.

**Redis keys:**
- `bot:dcmod:handled:{commentId}` — Dedup key, TTL 1 hour
- `bot:chainmod:depth-log` — Audit log, capped at 200 entries

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `depthCapModEnabled` | `true` | Enable/disable |
| `depthCap` | `10` | Maximum comment depth |
| `depthCapIgnoreModerators` | `true` | Exempt moderators |
| `depthCapIgnoreContributors` | `true` | Exempt approved submitters |
| `depthCapResponse` | `''` | Notice text (uses a generic fallback if blank) |
| `depthCapReport` | `true` | Submit the triggered comment as a report to the mod queue; disable to prevent queue clogging |

---

### Self-Response Moderator

**File:** `src/server/trigger-modules/self-response-moderator.ts`  
**Trigger:** `onCommentCreate`

Removes and locks top-level comments where the commenter is the original post author. Only fires on direct replies to the post (depth 1) — replies within threads are not affected.

**Redis keys:**
- `bot:srmod:handled:{commentId}` — Dedup key, TTL 1 hour
- `bot:srmod:log` — Audit log, capped at 200 entries

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `selfResponseModEnabled` | `true` | Enable/disable |
| `selfResponseIgnoreModerators` | `true` | Exempt moderators |
| `selfResponseIgnoreContributors` | `true` | Exempt approved submitters |
| `selfResponseResponse` | `''` | Notice text (leave blank for silent removal) |

---

### Length Moderator

**File:** `src/server/trigger-modules/length-moderator.ts`  
**Triggers:** `onPostSubmit`, `onPostFlairUpdate`

Enforces two post length rules:

1. **Max unhosted length** — Posts with a specific flair template ID are removed if the body (whitespace-excluded) exceeds the configured character limit.
2. **Min hosted length** — Posts containing a URL are removed if the body is shorter than the configured minimum (enforces a summary requirement for link posts).

The flair-update trigger uses a separate dedup key so a post that passes on submit can still be caught if a moderator applies the restricted flair later.

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `lengthModEnabled` | `true` | Enable/disable |
| `lengthModFlairId` | `''` | Flair template ID that triggers max-length enforcement |
| `lengthModMaxUnhostedLength` | `0` | Character cap for flaired posts (0 = disabled) |
| `lengthModMinHostedLength` | `0` | Min chars for link posts (0 = disabled) |
| `lengthModMaxUnhostedComment` | `''` | Removal notice for posts exceeding max length |
| `lengthModMinHostedComment` | `''` | Removal notice for link posts below min length |

---

### Report Moderator

**File:** `src/server/trigger-modules/report-moderator.ts`  
**Triggers:** `onCommentReport`, `onPostReport`

Silently ignores reports on content authored by known bot accounts: `AutoModerator`, `FloodAssistant`, this app's own account, and the apps split out of the toolbox, `predatory-journal-watch` and `define-bot` (`STATIC_BOT_AUTHORS` in the module). This keeps bot moderation notices out of the mod report queue.

No configurable settings.

---

### Flair Transfer

**File:** `src/server/trigger-modules/flair-transfer.ts`  
**Triggers:** `onPostFlairUpdate`

Counts posts whose new flair matches a configured post flair template ID and awards a configured user flair template ID once the same author reaches the configured threshold.

This module starts fresh from deployment onward. Each qualifying post is counted once permanently through a dedupe key, and each user's progress record is stored in Redis without expiry. Moderators are exempt. If user-flair application fails, the module queues a retry for the scheduler to attempt again 5 minutes later.

**Redis keys:**
- `flair-transfer:post:{postId}` â€” Permanent dedupe key for counted qualifying posts
- `flair-transfer:user:{userId}` â€” Persistent per-user progress record
- `flair-transfer:retry-queue` â€” Sorted set of pending award retries

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `flairTransferEnabled` | `true` | Enable/disable |
| `flairTransferPostFlairTemplateId` | `''` | Post flair template ID that counts toward the award |
| `flairTransferUserFlairTemplateId` | `''` | User flair template ID to award at threshold |
| `flairTransferRequiredPostCount` | `1` | Number of qualifying posts required for the award |
| `flairTransferOverwriteExistingUserFlair` | `false` | Allow replacing a non-empty existing user flair |

---

## Action Modules (Menu Items)

### Chain Mop

**File:** `src/server/action-modules/mop-tool.ts`  
**Menu location:** Comment

Recursively removes and/or locks an entire comment subtree starting from the selected comment. Actions are applied deepest-first (post-order traversal).

A confirmation form lets the moderator choose: Remove, Lock, and/or Skip distinguished comments. Both actions can be applied simultaneously.

After removal, a Reddit removal note is attached to the root comment recording the moderator's name and the count removed.

**Redis keys:**
- `bot:chainmod:session:{username}` — Session data, TTL 5 min
- `bot:chainmod:log` — Audit log, capped at 200 entries

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `mopToolEnabled` | `true` | Enable/disable |

---

### Saved Responses

**File:** `src/server/action-modules/response-tool.ts`  
**Menu location:** Post and Comment

A library of templated moderation messages that can be applied to posts or comments. Create responses once; they're available from any menu going forward.

**Apply flow:** Menu → select response → confirm/edit message + options → post.

**Options when applying:**
- Post as **Bot** or **Moderator (you)**
- **Distinguish** comment (bot-posted only)
- **Lock** the target post or comment

**Manage flow (subreddit menu):** Choose New, Edit, or Delete.

**Template macros** (expanded at send time):

| Macro | Expands to |
|-------|-----------|
| `{get_username}` | `u/AuthorName` of the target |
| `{get_post_flair}` | Flair text of the post |
| `{modmail}` | Markdown link to subreddit modmail |

Responses have a `location` property (`both` / `post` / `comment`) that controls where they appear in menus.

**Redis keys:**
- `bot:savedresponses` — All saved responses (JSON array)
- `bot:savedresponses:log` — Audit log, capped at 200 entries
- `bot:savedresponses:apply:{username}` — Apply session, TTL 5 min
- `bot:savedresponses:edit:{username}` — Edit session, TTL 5 min

**Settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `responseToolEnabled` | `true` | Enable/disable |

---

### Flood Quota Checker

**File:** `src/server/action-modules/quota-viewer.ts`  
**Menu location:** Subreddit

Lets moderators look up any user's current post quota status. Shows each tracked post, whether it counts toward the quota, and when the user's next posting slot opens.

**Flow:** Subreddit menu → Flood Quota Checker → enter username → view results → search again.

Requires the Flood Moderator to be enabled.

---

---

## All Settings Reference

| Key | Module | Type | Default |
|-----|--------|------|---------|
| `botSignature` | Global | string | `'I am a bot...'` |
| `floodModEnabled` | Flood | boolean | `true` |
| `floodAssistantMaxPosts` | Flood | number | `1` |
| `floodAssistantWindowHours` | Flood | number | `24` |
| `floodAssistantIgnoreModerators` | Flood | boolean | `true` |
| `floodAssistantIgnoreContributors` | Flood | boolean | `true` |
| `floodAssistantIgnoreAutoRemoved` | Flood | boolean | `true` |
| `floodAssistantIgnoreRemoved` | Flood | boolean | `true` |
| `floodAssistantIgnoreDeleted` | Flood | boolean | `true` |
| `floodAssistantResponse` | Flood | string | `''` |
| `depthCapModEnabled` | Depth Cap | boolean | `true` |
| `depthCap` | Depth Cap | number | `10` |
| `depthCapIgnoreModerators` | Depth Cap | boolean | `true` |
| `depthCapIgnoreContributors` | Depth Cap | boolean | `true` |
| `depthCapResponse` | Depth Cap | string | `''` |
| `depthCapReport` | Depth Cap | boolean | `true` |
| `selfResponseModEnabled` | Self-Response | boolean | `true` |
| `selfResponseIgnoreModerators` | Self-Response | boolean | `true` |
| `selfResponseIgnoreContributors` | Self-Response | boolean | `true` |
| `selfResponseResponse` | Self-Response | string | `''` |
| `lengthModEnabled` | Length | boolean | `true` |
| `lengthModFlairId` | Length | string | `''` |
| `lengthModMaxUnhostedLength` | Length | number | `0` |
| `lengthModMinHostedLength` | Length | number | `0` |
| `lengthModMaxUnhostedComment` | Length | string | `''` |
| `lengthModMinHostedComment` | Length | string | `''` |
| `flairTransferEnabled` | Flair Transfer | boolean | `true` |
| `flairTransferPostFlairTemplateId` | Flair Transfer | string | `''` |
| `flairTransferUserFlairTemplateId` | Flair Transfer | string | `''` |
| `flairTransferRequiredPostCount` | Flair Transfer | number | `1` |
| `flairTransferOverwriteExistingUserFlair` | Flair Transfer | boolean | `false` |
| `mopToolEnabled` | Chain Mop | boolean | `true` |
| `responseToolEnabled` | Saved Responses | boolean | `true` |
| `supabaseUrl` | Bot logs | string | — |
| `supabaseServiceKey` | Bot logs | string | — |

### Bot Signature

The `botSignature` setting appends a formatted signature to all bot-generated comments. Each word is wrapped in Reddit's `^word` superscript syntax, preceded by a horizontal rule.

Example: setting `"I am a bot"` produces:

```
---

^I ^am ^a ^bot
```

Leave blank to post removal messages with no signature.

---

---

## Local Commands

```sh
npm run check       # lint + typecheck + test + vite build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest (no Reddit login required)
npm run build       # Vite build -> dist/server/index.cjs
npm run dev         # npx devvit playtest (requires Devvit login)
```

### No-Login Testing (offline virtual Reddit)

`createModTest()` in `src/server/test-harness/` wraps `@devvit/test` with:

- **`FakeRedditWorld`**: subreddits, users (mods, approved, banned, bots), threaded posts and comments, flair, reports, removals and approvals, modmail, wiki pages, mod notes and private messages behind the `reddit.*` API. Every write the app makes is logged (`world.describeActions()`).
- **`ScenarioRunner`**:
  - Simulates Reddit activity (`userPosts`, `userComments`, `report`, `modRemoves`, `userModmails`, `install`, …) and fires whichever triggers `devvit.json` declares.
  - Clicks menus and submits forms as a given user.
  - Advances a fake clock that runs cron tasks and `scheduler.runJob` jobs.
  - Offers a `given` / `when` / `then` scenario DSL.
- **`FakeHttp`**: per-domain `fetch` stubs. An unstubbed call fails the test, so does a host missing from `devvit.json` `permissions.http.domains`, and reddit.com is always blocked.
- **Coverage**: `expectAllEndpointsCovered()` fails if any declared trigger, menu, form or scheduler endpoint has no scenario.

See [`src/server/test-harness/README.md`](src/server/test-harness/README.md) for the API and known gaps, and `src/server/toolbox.scenarios.test.ts` for this app's scenarios.

This repo keeps the harness up to date with `npm run harness:sync`. `npm run harness:check` and the weekly `harness-drift` workflow report drift. Do not edit `src/server/test-harness/` here; change it in [devvit-app-template](https://github.com/AllHailSeizure/devvit-app-template) and sync.

> `createModTest()` wraps plain `test(...)` calls only. For parameterised cases, loop over the cases and call `test(...)` for each one: `test.each` / `test.for` bypass the wrapper, so their tests get no `world` or `runner`.

---

## Required GitHub Secret (`DEVVIT_AUTH_TOKEN`)

The manual release workflow requires a repository (or organization) secret named **`DEVVIT_AUTH_TOKEN`** containing the **full raw contents** of your logged-in `~/.devvit/token` file:

```sh
npx devvit login
npx devvit whoami
gh secret set DEVVIT_AUTH_TOKEN < ~/.devvit/token
```

On Windows PowerShell:

```powershell
npx devvit whoami
Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.devvit/token') -Raw |
  gh secret set DEVVIT_AUTH_TOKEN
```

> **Security & reliability note:** `DEVVIT_AUTH_TOKEN` is an undocumented CLI environment variable holding your personal Reddit OAuth refresh token — not a scoped CI service account. Keep it strictly on `master` release jobs (never PR workflows), rotate it if compromised, and note that it can expire or require re-login (`devvit login`) if Reddit invalidates sessions.

---

## Versioning & Release Process

### Versioning Rules

- **Strict 3-part SemVer only:** `MAJOR.MINOR.PATCH` (e.g. `1.2.0`). Never use 4-part versions or prerelease suffixes for releases.
- **Lockstep invariant:** Every release keeps four artifacts identical:
  1. `package.json` (`"version": "X.Y.Z"`)
  2. Git tag (`vX.Y.Z`)
  3. GitHub Release (`vX.Y.Z`)
  4. Devvit App Store (`X.Y.Z`)

### Running a Release

1. Merge all changes to `master` and wait for **CI** (`ci.yml`) to pass.
2. Open **Actions → Release Devvit app → Run workflow** on `master`:
   - **`bump`:** `patch`, `minor`, `major`, or `explicit`
   - **`version`:** only fill in when `bump` is `explicit` (e.g. `1.0.0`)
   - **`visibility`:** `unlisted` (default) or `public`
3. The workflow bumps `package.json` & `package-lock.json`, runs `npm run check`, authenticates via `DEVVIT_AUTH_TOKEN`, runs `npx --no devvit publish --version X.Y.Z` (with `DEVVIT_ALLOW_SOURCE_UPLOAD=1` and optional `--public`), commits + tags `vX.Y.Z` on `master`, creates GitHub Release `vX.Y.Z`, and asserts `tag == package.json == Devvit App Store version`.

> Note: `devvit publish` submits a version to Reddit's Developer Portal. Installing/upgrading on a subreddit (`devvit install`) and deploying any external Supabase migrations/functions remain separate steps.
