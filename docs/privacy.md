---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy — Moderator Toolbox

**Effective Date:** 2026-11-25

## 1. What the app does

**Moderator Toolbox** ("the app") runs on Reddit communities through Reddit's Devvit platform. It reacts to new posts, new comments, flair changes, reports, removals and deletions in the installing subreddit, and gives moderators menu tools. Depending on which modules the moderators turn on, it:

- removes posts over a posting quota (Flood), or outside configured length limits (Length);
- locks comment chains that reach a configured depth (Depth Cap) and acts on configured OP self-replies (Self-Response);
- warns authors who repeatedly do not respond to commenters, and may report repeat cases to moderators (Nonresponder Check);
- awards user flair after a number of posts with a qualifying post flair (Flair Transfer);
- ignores reports on comments and posts written by known bot accounts (Report Moderator);
- lets moderators remove or lock a comment chain (Chain Mop), post saved replies (Saved Responses), and look up a user's posting quota (Flood Quota Checker).

As of this version, the app does **not** check journal links or answer `!define`. Those features moved to the separate apps Predatory Journal Watch and Define Bot, which have their own policies.

## 2. Data the app processes

- **Post and comment metadata**: IDs, author IDs and usernames, timestamps, flair, removal/lock/approval state, and, for the Length module, the post body length. Post and comment text is read in memory to apply the rules; it is not stored by the app.
- **Moderator and approved-user status** of authors, read from Reddit to apply exemptions.
- **Moderator actions** taken through the menu tools, including the moderator's username.
- **Saved responses** written by moderators.
- **Bot comments** the app posts publicly on Reddit under its own account (or, for Saved Responses when a moderator chooses it, under that moderator's account).

The app does not use any AI service, does not build profiles, and does not sell data or use it for advertising.

## 3. Third parties

- **Reddit** runs the app and stores its Redis data and comments.
- **Supabase** (optional). If the operator enables optional log mirroring to Supabase, each log line the app writes is also inserted into a `bot_logs` table in the operator's Supabase project. A log line has a level, module name, message, and may include action, reason, user ID, post ID, comment ID and other event details (for example usernames). Supabase processes this under the [Supabase Privacy Policy](https://supabase.com/privacy). If mirroring is not configured, nothing is sent to Supabase.

The app calls no other outside service.

## 4. Retention

**Devvit Redis**, scoped to the installing subreddit:

| Data | Kept for |
| --- | --- |
| Per-event "already handled" markers (most modules) | 1 hour |
| Nonresponder handled marker / warning-comment ID | 7 days / 180 days |
| Flood post tracking (`flood:post:{postId}`, `flood:posts`) | 8 days per post; older entries are pruned |
| Flair Transfer progress per post and per user (username, count) | Until the app is uninstalled |
| Saved responses | Until a moderator deletes them or the app is uninstalled |
| Menu form sessions | 5 minutes |
| Module action logs (depth cap, self-response, chain mop, saved responses, nonresponder) | The most recent 200 entries each |
| Operational logs `bot:log:{info, warn, error}` | The most recent 500 entries per level |

- **Supabase `bot_logs`** (only if configured): rows are kept until the operator deletes them; the app does not expire them.
- Devvit platform logs, whose retention Reddit controls, hold the same log lines.
- Uninstalling the app removes its Redis data for that subreddit. It does not delete Supabase rows; ask the operator.
- Bot comments are ordinary Reddit comments that moderators can remove.

## 5. Contact

For questions or removal requests, contact the subreddit's moderators, or open an issue at [github.com/AllHailSeizure/moderator-toolbox](https://github.com/AllHailSeizure/moderator-toolbox/issues).
