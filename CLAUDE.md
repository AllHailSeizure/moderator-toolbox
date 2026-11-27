# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
npm run check        # lint + typecheck + tests + build (what CI runs)
npm test             # Vitest, FakeRedditWorld harness, no Reddit login
npm run build        # Vite → dist/server/index.cjs
devvit playtest r/llmphysics_dev   # live playtest: Nate only, never from automation
```

Playtest URL (re-add manually when a post opens in a new tab):
```
https://www.reddit.com/r/llmphysics_dev/?playtest=llmphysics-bot
```

Tests run locally with `npm test` (Vitest + `@devvit/test` + `src/server/test-harness` FakeRedditWorld). They never contact Reddit or Supabase.

The predatory-journal-watch module and the `!define` command were split into their own apps (AllHailSeizure/predatory-journal-watch, AllHailSeizure/define-bot). See `CUTOVER.md`.

---

## Live Observability

Two MCP tools are available for live observation during development and testing. Use them instead of reading log files or guessing state.

### Bot logs — Devvit MCP / CLI

**Via Bash (reliable):**
```bash
devvit logs r/llmphysics_dev llmphysics-bot --since 30m --show-timestamps
```
Key flags: `--since` (e.g. `5m`, `1h`), `-j` (JSON output), `--show-timestamps`.

**Via MCP tool** (`mcp__devvit-mcp__devvit_logs`):
```
{ subreddit: "llmphysics_dev", app: "llmphysics-bot", since: "30m" }
```
Note: this tool requires `npx` in the MCP server's PATH. If it fails with `spawn npx ENOENT`, fall back to the Bash form above.

## Build System: Vite

The project uses **Vite** (`vite.config.mts`, from devvit-app-template) to build the server to `dist/server/index.cjs` (CommonJS, required by the Devvit runtime). There is no webview client.

---

## MVP-First Development

Build the minimal core first, confirm it works end-to-end, then add the next layer. Propose explicit phases in plan mode and get agreement before moving on. Never build backend + data layer + frontend + scheduler all at once — if something breaks you can't isolate where.

---

## Architecture

Reddit events → `devvit.json` → `POST /internal/triggers/<slug>` → `registry.ts` → `dispatch()` → each module's `run(event)`.

`index.ts` is 9 lines and never changes. `registry.ts` is the only file edited to add/remove modules.

### Module types

**Trigger modules** (`trigger-modules/`) — activated by Reddit events. Export a single `run(event)` typed to their trigger.

**Action modules** (`action-modules/`) — activated by overflow-menu clicks. Export `register(app: Hono)` that mounts Hono routes (`/internal/menu/<name>` and `/internal/forms/<name>`). Must also declare the menu item in `devvit.json`.

### Dispatch isolation

`dispatch()` wraps each module in try/catch. A thrown error is logged and execution continues with the next module in the array.

### Module enable/disable

Every trigger module checks its enabled flag as its **first line** and returns early if off:

```typescript
const enabled = (await settings.get<boolean>('myModEnabled')) ?? true;
if (!enabled) return;
```

Naming convention: `<camelCasePrefix>Enabled` (e.g. `depthCapModEnabled`, `floodModEnabled`). Declare in `devvit.json` under `settings.subreddit` with `"type": "boolean"` and `"defaultValue": true`.

### Adding a module (2 lines in `registry.ts`)

```typescript
// Trigger module
import { run as myModule } from './trigger-modules/my-module';
const POST_SUBMIT: PostSubmitHandler[] = [...existing, myModule];

// Action module
import { register as registerMyModule } from './action-modules/my-module';
// inside registerAll(): registerMyModule(app);
```

**Action modules also require `devvit.json` entries** for the menu item to appear and the form callback to work. Add one object to `menu.items` (with `label`, `description`, `forUserType`, `location`, `endpoint`) and one key-value pair to `forms` (name → Hono route path).

## Settings System

**Settings** are declared in `devvit.json` under `settings.subreddit` (mod-editable from the app's install settings page) or `settings.global` (operator-only values such as optional off-site log mirroring). Read via `import { settings } from '@devvit/web/server'` → `(await settings.get<T>('key')) ?? defaultValue`. The old Redis-backed `settings:*` store and its unreachable admin menu were removed; nothing reads those keys.

`helpers/signature.ts` `formatSignature(raw)` superscripts each word of `botSignature` and prepends `---`; returns `''` on empty input.

**Adding a new setting:** add a key to `devvit.json` `settings.subreddit` with `type`, `label`, `helpText`, and `defaultValue`. Then read it in the module with `settings.get<T>()`. No other files need to change.

---

## Logger

```typescript
const log = logger('my-module');   // call once at module scope
log.info('msg', { data });
log.warn('msg');
log.error('msg', err, { data });   // err is serialized to { message, stack }
```

`helpers/logger.ts`. All levels write to console (visible via `devvit logs`). Each level is also persisted to a Redis sorted set (`bot:log:info`, `bot:log:warn`, `bot:log:error`), capped at 500 entries (oldest evicted), and, when optional Supabase log mirroring is configured, inserted into the Supabase `bot_logs` table. `logZSet(key, entry, max)` appends to a capped per-module log.

---

## Devvit Platform: Hard-Won Knowledge

**Vite bundles everything into CommonJS.** The platform requires the server entry (`dist/server/index.cjs`) to be CommonJS. The `@devvit/start/vite` plugin handles this automatically. Do not use ESM syntax in the server code.

**No `--external` flags during bundling.** The platform does not expose packages at runtime. Vite bundles all dependencies into the server output.

**The HTTP server runs in the cloud**, not locally. `devvit playtest` uploads the compiled bundle; the platform executes it. Port 5678 / the VS Code devtunnel is only the live-reload WebSocket (started with `--connect`).

**Form submissions** for action modules arrive as a JSON body at `POST /internal/forms/<name>`. Boolean fields come back as `true`/`false` booleans (not strings). Select fields come back as `string[]`.

**`devvit.json` `scripts.build` is never called by the CLI.** Always run `npm run build` manually before `devvit playtest`.

**`forUserType` in menu items:** `"moderator"` (mod-only) or `"user"` (all logged-in users). `"user"` does not bypass permission checks — `reddit.remove()` etc. still require moderator privileges.

**NEVER auto-bump the version to work around deployment errors.** If `devvit playtest` fails with "AppVersion already exists," ask first before changing `package.json` version. The issue is usually environmental (lingering process, platform state) and will resolve itself or needs manual investigation — not a version bump band-aid.

## Nonresponder Check

Module: `src/server/trigger-modules/nonresponder-check.ts` (pure logic in `nonresponder-decision.ts`), imported as `runNonresponderCheck` and registered in `POST_SUBMIT`. Keep camelCase platform settings in `devvit.json`, read via `settings.get`: `nonresponderModEnabled`, `nonresponderPostsToCheck` (2), `nonresponderMinComments` (3 other-user comments), `nonresponderReportRepeat` (true), `nonresponderSkipLockedComments` (true), `nonresponderRunOnMods` (false), `nonresponderRunOnApprovedUsers` (true), and `nonresponderResponse`.

Moderators are exempt by default (`nonresponderRunOnMods=false`); approved users are checked by default (`nonresponderRunOnApprovedUsers=true`). For a moderator who is also approved, the moderator setting wins. Always skip missing/deleted posters and the app's own account; it is also excluded from other-user counts, reply parents, and used for warning detection. Other bots/apps are checked like anyone else, with exemptions only through moderator/approved status; there is no username list.

With `nonresponderSkipLockedComments=true` (default), locked comments (including AutoModerator, mod notices, or bots/apps) do not count toward the minimum, and OP replies to locked parents do not count as responses. Unlocked moderator comments count normally. A lock on OP's own reply does not matter: it counts if the reply survives and its parent is eligible. Turning this off lets locked comments and replies to them count, except app authors remain excluded.

Fetch each candidate tree once; pure decisions count surviving eligible-user comments excluding OP and app accounts, and surviving OP replies to other eligible users. Removed parents count if their author is known; unknown/deleted authors do not. Scan 50 history posts, at most 10 candidate trees, 500 comments/50 listings per tree; incomplete scans mean no action. Warn on every qualifying new post. If all checked posts were warned, report the new post after warning via `reddit.report`; failures are logged. Redis: `bot:nrmod:handled:{postId}` (7 days), `bot:nrmod:warned:{postId}` (warning ID, 180 days), `bot:nrmod:log` (includes escalation requested/succeeded). Fallback uses distinguished app comments starting with the current warning text; changed text may miss expired/untracked warnings. See README for details.
