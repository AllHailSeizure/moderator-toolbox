# Changelog

All notable changes to moderator-toolbox. Format: `module(<scope>): description`.

---

## [0.0.4] — Baseline import (not published from this repo)

Imported from `Reddit-Devvit/moderator-toolbox` at the version last published to the Devvit App Store (0.0.4). Repo-level changes, no live release yet:

- Removed predatory-journal-watch (now github.com/AllHailSeizure/predatory-journal-watch) and the `!define` command with its command helper (now github.com/AllHailSeizure/define-bot), with their settings and HTTP domains. See `CUTOVER.md`.
- Removed dead code: `paper-fetch-helper.ts`, the unrouted admin menu (`admin.ts`, `settings-registry.ts`) and the Redis `settings:*` helpers, `scripts/verify-*.mjs`, the `process-review` edge function and bingo migrations 009-013. The adversarial-review migrations and prompt and the PJW edge functions and migrations 014-016 now live in their own repos.
- Added `predatory-journal-watch` and `define-bot` to the report-moderator bot-author list.
- Moved to the devvit-app-template Devvit 0.15.6 stack (lint, typecheck, Vitest with FakeRedditWorld, CI). Redis keys of kept modules are unchanged.

## [Unreleased]

- (moved to predatory-journal-watch) `module(predatory-journal-watch)`: Warn, without removing or reporting, when a post or comment links a watchlisted predatory or hijacked journal domain or a DOI that resolves to one. One combined comment per item, at most once per publisher per post. Allowlist defaults to MDPI and Frontiers. Watchlist is synced to Supabase from the Retraction Watch hijacked-URL column and Beall's List. DOI resolution and watchlist matching run in the `resolve-doi` edge function; the Devvit app calls only Supabase. Markdown-wrapped doi.org autolinks are extracted (Reddit stores `[url](url)`); skip paths log a reason. A publisher watchlist row keeps its name when a standalone journal reuses the publisher domain (e.g. SCIRP / scirp.org).
- `module(nonresponder-check)`: Warn nonresponding authors on post submit after the latest 2 qualifying posts with 3+ surviving other-user comments and no OP responses. Exclude OP, app authors, missing/deleted authors, and removed/deleted/spam comments. `nonresponderSkipLockedComments` (true) excludes locked comments and replies to locked parents; locking OP’s reply does not invalidate it. Unlocked mod comments count normally. `nonresponderRunOnMods` (false) takes precedence over `nonresponderRunOnApprovedUsers` (true). Skip app-account posters; other bots/apps are checked normally with no username list. Bounded scans, duplicate protection, configurable warning, and repeat reporting (`nonresponderReportRepeat=true`; warnings tracked for 180 days with comment fallback).
- Engineering standards baseline: ESLint, Prettier, MODULE descriptor, structured logging standard, settings naming convention, Redis key convention, hierarchical CLAUDE.md files
- `module(flair-transfer)`: transfer qualifying post flair milestones into user flair awards with retry scheduling — pending verification

---

## [2.11.0] — Previously published (Adversarial LLM Reviewer)

- `module(adversarial-reviewer)`: PDF paper review pipeline with LLM critique; mod-menu triggered; Supabase review_jobs table

## [2.9.1] — Previously published

- `fix(length-moderator)`: Module toggle bugfix; trigger on flair change

## [2.9.0] — Previously published

- Flood Moderator, Depth Cap, Self-Response, Length Moderator, Chain Mop, Saved Responses, Define Command — initial verified versions

---

_Versions prior to 2.9.0 not reconstructed. Future entries added by `/module-promote`._
