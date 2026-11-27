# Cutover: splitting Predatory Journal Watch and `!define` out of Moderator Toolbox

This repo's code no longer contains the predatory-journal-watch module or the `!define` command. They live in:

- **predatory-journal-watch**: <https://github.com/AllHailSeizure/predatory-journal-watch> (Devvit app `predatory-journal-watch`, 1.0.0)
- **define-bot**: <https://github.com/AllHailSeizure/define-bot> (Devvit app `define-bot`, 1.0.0)

The live subreddit still runs **moderator-toolbox 0.0.4** (published from Reddit-Devvit on 2026-11-11), which includes both features. Nothing here has been published. Do the steps below in order, by hand. Each step is reversible until step 6.

## Before you start

- Copy global install configuration from the current **moderator-toolbox 0.0.4** install into each new app. Use each app's README for which fields to set and how to set them.
- Supabase needs no schema change. Both new apps use the same project, existing PJW tables (`predatory_watchlist`, `doi_resolution`, `bot_logs`, and related lookup tables) and edge functions as today.
  - Redeploying `resolve-doi` and `sync-predatory-watchlist` from the PJW repo is optional. The code only changes the sync function's User-Agent to `predatory-journal-watch` and moves an import path.
- Publish each new app from its repository using that repo's maintainer process, or from your machine.

## Order

1. **Publish predatory-journal-watch 1.0.0** from its repo.
2. **Install it** on the subreddit. It stays silent until Supabase is configured: it skips content and does not mark it handled.
3. **Publish define-bot 1.0.0** and **install it**. It stays silent until its global install configuration is complete (see the define-bot README).
4. **In moderator-toolbox 0.0.4's subreddit settings, turn off:**
   - `predatoryWatchEnabled` ("Predatory Journal Watch — Enable")
   - `defineCommandEnabled` ("Define Command — Enable")

   This prevents duplicate replies while both apps run.
5. **Configure the new apps:**
   - **predatory-journal-watch:**
     - Global: set fields with `devvit settings set` in the PJW repo per that project's README.
     - Subreddit: copy `botSignature` and any non-default `predatoryWatchWarning`, `predatoryWatchAllowlist`, `predatoryWatchCheckComments` and `predatoryWatchMatchPublisherName` values from the toolbox install page.
   - **define-bot:**
     - Global and subreddit settings per the define-bot README (copy non-default `botSignature`, `defineCommandCategory`, and `defineCommandSearchGrounding` from the toolbox install page where applicable).
   - Smoke test:
     - Comment `u/define-bot !define [entropy]`. Users must now mention **u/define-bot**, not u/moderator-toolbox.
     - Post a link to a domain on the watchlist.
6. **Publish the slimmed moderator-toolbox** from this repo. Bump the version first. The suggestion is **0.1.0**, because features were removed. Then upgrade the install. The extracted settings disappear from its settings page.
7. **Tell the mod team:** the `!define` mention changed, and warnings now come from u/predatory-journal-watch.

## Data that resets

Devvit Redis is per app, so the new apps start empty. Nothing is migrated.

- **Predatory Journal Watch**
  - `bot:pjmod:pub:{postId}:{publisherKey}` (180 days) resets. A new comment on a post that was already warned about a publisher can get one more warning.
  - `bot:pjmod:handled:{contentId}` (7 days) resets. Only retried events are affected.
  - `bot:pjmod:log` and `bot:log:*` history starts fresh.
  - Supabase data (`doi_resolution` cache, watchlist, `bot_logs`) is shared and kept.
- **Define**: `bot:cmd:{contentId}` (1 hour) resets. This is harmless.
- **Moderator Toolbox**: no reset. Kept modules use the same Redis keys:
  - `bot:dcmod:*`, `bot:chainmod:*`, `bot:srmod:*`, `bot:nrmod:*`, `bot:rf:*`, `bot:flood:*`
  - `flood:post:*`, `flood:posts`
  - `flair-transfer:*`
  - `bot:savedresponses*`
  - `bot:log:*`
  - The old pjmod and `bot:cmd` keys stay in the toolbox's Redis, unused, until they expire.
  - Legacy `settings:*` keys from the removed admin menu were never read by installed settings, and stay unused.

## Report Moderator

The slimmed toolbox ignores reports on comments by `predatory-journal-watch` and `define-bot` (`STATIC_BOT_AUTHORS` in `src/server/trigger-modules/report-moderator.ts`). The other split-out apps also comment: `adversarial-review`, `tap-the-sign` and `llmphysics-bingo`. Add any of these you want treated the same way before step 6. Use the app account usernames as they appear on Reddit.

## Rollback

- **Before step 6:** turn `predatoryWatchEnabled` and `defineCommandEnabled` back on in moderator-toolbox 0.0.4, then uninstall or disable the new apps.
- **After step 6:**
  1. Republish Reddit-Devvit's `moderator-toolbox` at commit 77c6605 under a version higher than the slimmed one, then upgrade the install.
  2. Re-enter its settings if they were cleared: the 0.0.4 settings schema still has the PJW and define keys.
  3. Uninstall the new apps.
- Redis data written by the slimmed toolbox stays compatible with 0.0.4, because the keys are unchanged.
