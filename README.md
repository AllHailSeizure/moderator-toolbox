# Moderator Toolbox

**Automatic posting rules and mod-menu tools for busy subreddits — on Reddit via Devvit.**

Moderator Toolbox watches new posts and comments, enforces limits you configure, and adds moderator-only menu actions for chains, canned replies, and quota lookups. It runs in the background under the app’s Reddit account and respects exemptions for moderators and approved submitters where each module allows it.

<!-- SCREENSHOT: Subreddit overflow menu showing Chain Mop on a comment and Saved Responses on a post -->
> 📸 Screenshot coming soon: Moderator menu items on a post and comment

This version does **not** include Predatory Journal Watch or the `!define` command. Those live in separate Devvit apps. See [CUTOVER.md](CUTOVER.md) if you are upgrading from an older install that had them.

For a longer walkthrough written for your mod team, see [moderator-onboarding-guide.md](moderator-onboarding-guide.md). Privacy and terms: [docs/privacy.md](docs/privacy.md), [docs/terms.md](docs/terms.md).

---

## What it does

- **Nonresponder check** — On new posts, checks whether the author recently engaged with commenters on qualifying older posts. Can post a distinguished, stickied, locked warning and, when configured, report repeat cases to the mod queue.
- **Flood moderator** — Limits how many posts a user may submit in a rolling time window. Removes over-quota posts and can leave an explanatory comment.
- **Depth cap** — Locks very deep comment threads and posts a notice when a reply hits the maximum depth.
- **Self-response** — Removes and locks top-level replies where the original poster comments directly on their own post (depth 1 only).
- **Length moderator** — Removes posts that exceed a max length for a configured flair, or link posts whose body is below a configured minimum.
- **Flair transfer** — Counts posts with a configured post flair and awards a configured user flair after a threshold (optional; off by default).
- **Report moderator** — Silently ignores reports on posts and comments from known bot accounts so bot notices do not clog the mod queue.
- **Chain Mop** — Menu tool to remove and/or lock an entire comment subtree.
- **Saved Responses** — Library of templated mod messages; apply from posts or comments, manage from the subreddit menu.
- **Flood Quota** — Menu tool to look up a user’s rolling post quota and recent tracked posts.

There are **no user-facing text commands** (such as `!define`) in this app.

---

## Install the app on your subreddit

You need **moderator permissions** to install a Devvit app on a community.

1. Open your subreddit’s **Mod Tools**.
2. Go to **Installed Apps** (or the Devvit apps section Reddit shows for your community).
3. Find **Moderator Toolbox** (`moderator-toolbox` in the Devvit catalog) and install or upgrade it.
4. Open the app’s **Settings** page for your subreddit to turn modules on or off and set limits and messages.

App-wide secrets (optional log mirroring to Supabase) are set by the app operator, not in the subreddit settings list: `supabaseUrl` and `supabaseServiceKey` in global install settings.

---

## Menu tools (moderators only)

Open the **⋯** menu on a post, comment, or on the subreddit feed (for subreddit-level items).

| Menu label | Where it appears | What it does |
|------------|------------------|--------------|
| **Chain Mop** | Comment | Remove and/or lock this comment chain |
| **Saved Responses** | Post, Comment | Pick a canned response, edit it, choose bot vs your account, optional distinguish (bot only) and lock |
| **Saved Responses** | Subreddit | Add, edit, or delete entries in the response library |
| **Flood Quota** | Subreddit | Search a username; the form title is “Flood Quota Checker” |

### Chain Mop

1. Choose **Chain Mop** on the comment that roots the chain you want to clean up.
2. In the form, select **Remove comments**, **Lock comments**, and/or **Skip distinguished comments**.
3. Confirm. A removal note on the root comment records your username and how many comments were removed.

### Saved Responses

**Apply:** Choose **Saved Responses** on a post or comment → select a template → edit the message → choose **Post comment as** Bot or **Moderator (you)** → optional **Distinguish comment** (bot only) and **Lock target** → submit.

**Manage:** Subreddit menu → **Saved Responses** → New, Edit, or Delete.

Template macros (expanded when the message is sent):

| Macro | Becomes |
|-------|---------|
| `{get_username}` | `u/AuthorName` of the target post or comment |
| `{get_post_flair}` | Flair text of the post |
| `{modmail}` | Markdown link to the subreddit’s modmail |

Example body you might save:

```text
Hi {get_username}, your post with flair {get_post_flair} needs a longer summary.
Questions? Use {modmail}.
```

Each saved response has a visibility of post only, comment only, or both, which controls which menus list it.

### Flood Quota

Requires the flood moderator to be enabled. Subreddit menu → **Flood Quota** → enter a username (without `u/`) → review quota-eligible posts and when the next slot opens.

---

## Automatic rules (settings)

Open **Mod Tools → Installed Apps → Moderator Toolbox → Settings**. Each module has an **Enable** toggle unless noted. Blank **message** fields mean the bot acts without posting a public comment (where the module supports that).

### General

| Setting | Purpose |
|---------|---------|
| **Bot signature** | Text appended to bot comments (formatted with a horizontal rule and superscript words). Leave blank for no signature. Default warns readers that the action was automatic. |

### Nonresponder check

| Setting | Default |
|---------|---------|
| Enable | On |
| Previous posts to check | 2 |
| Minimum comments per post (other users) | 3 |
| Skip locked comments | On |
| Run on moderators | Off |
| Run on approved users | On |
| Report repeat nonresponders | On |
| Warning comment | Rule reminder to reply to commenters |

### Flood assistant

| Setting | Default |
|---------|---------|
| Enable | On |
| Max posts per window | 1 |
| Window (hours) | 24 |
| Ignore moderators | On |
| Ignore contributors (approved submitters) | On |
| Ignore auto-removed posts | On |
| Ignore moderator-removed posts | On |
| Ignore deleted posts | On |
| Flood assistant triggered comment | (blank = silent removal) |

### Depth cap

| Setting | Default |
|---------|---------|
| Enable | On |
| Maximum comment depth | 10 (set to **0** to disable depth enforcement) |
| Depth cap triggered comment | Notice when cap fires |
| Submit report to mod queue | On |

### Self-response moderator

| Setting | Default |
|---------|---------|
| Enable | On |
| Ignore moderators | On |
| Ignore approved submitters | On |
| Self-response triggered comment | (blank = silent removal) |

### Length moderator

| Setting | Default |
|---------|---------|
| Enable | On |
| Restricted flair template ID | (blank = max-length rule off) |
| Max unhosted length (characters) | 0 (off) |
| Min hosted length for link posts (characters) | 0 (off) |
| Over-length removal message | Custom text |
| Under-length removal message | Custom text |

### Flair transfer

| Setting | Default |
|---------|---------|
| Enable | **Off** |
| Source post flair template ID | — |
| Target user flair template ID | — |
| Required qualifying posts | 1 |
| Overwrite existing user flair | Off |

### Menu modules

| Setting | Default |
|---------|---------|
| Chain Mop — Enable | On |
| Saved Responses — Enable | On |

### Report moderator

No settings. Reports are ignored for content authored by `AutoModerator`, `FloodAssistant`, `predatory-journal-watch`, `define-bot`, and this app’s own account.

---

## License

This project is licensed under the **MIT License** (Copyright © 2026 Nate Bosma). See [LICENSE](LICENSE).

---

## Contributing

Code changes are welcome via GitHub. See [CONTRIBUTING.md](CONTRIBUTING.md).