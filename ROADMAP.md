# moderator-toolbox Roadmap

> **Process contract:** Before starting any new module, write its ROADMAP entry first.
> Use `/module-new` — it will ask clarifying questions and produce the spec.
> If the goal can't be stated in one sentence, the scope isn't ready.
> Implementation doesn't start until the spec is signed off.

---

## Flair Transfer — Queued

**Goal:** When a post receives a configured post flair template ID enough times for the same author, assign that author a configured user flair template ID.

**Spec highlights:**
- Trigger: `onPostFlairUpdate`
- Action: when the new post flair template ID matches the configured source flair, count that post once for its author; when the author reaches the configured threshold, assign the configured user flair template ID
- Exemptions: moderators are exempt and never counted or awarded
- Settings: `flairTransferEnabled`, `flairTransferPostFlairTemplateId`, `flairTransferUserFlairTemplateId`, `flairTransferRequiredPostCount`, `flairTransferOverwriteExistingUserFlair`
- Redis: permanent dedupe key per counted post; permanent per-user progress record; pending-award retry state with a 5 minute delay before retry
- Edge cases: disabled state is a full silent no-op with no logging; counted posts never decrement; duplicate flair updates for the same post must not double count; flair-application failure queues a retry rather than dropping the award; overwrite of existing user flair is off by default and only occurs when explicitly enabled

**Milestones:**
- [x] Implement module file (full, not stubbed)
- [x] Wire registry, settings, devvit.json
- [x] `npm run build` — zero errors
- [x] Playtest
- [ ] Verify (automated + interactive)
- [ ] Publish via /module-promote

**Testing plan:**
- Automated: verify source-flair matching, moderator exemption, post dedupe, count persistence, threshold crossing, overwrite-off behavior, overwrite-on behavior, and pending-award retry scheduling
- Interactive: apply the configured source flair to qualifying posts in `r/llmphysics_dev`, confirm counts advance once per post, confirm moderator-authored posts are ignored, confirm award occurs at threshold, and confirm a failed flair application is retried after 5 minutes
