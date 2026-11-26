# Helpers Guide

Add new helpers here only when logic is needed by 2+ modules. Keep module-specific logic in the module file.

---

## logger.ts

```typescript
import { logger } from './logger';
const log = logger(MODULE.name);  // bind once at module scope

log.info('event_name', { userId, postId });   // structured data, not strings
log.warn('unexpected_state', { detail });
log.error('handler_failed', err, { context }); // err is serialised automatically
```

`logZSet(key, entry, maxEntries?)` — low-level: appends a timestamped JSON entry to a Redis sorted set and trims to `maxEntries`. Used by modules that maintain their own audit logs (e.g. saved-responses).

---

## signature.ts

```typescript
import { formatSignature } from './signature';
const sig = formatSignature(raw);       // superscripts each word, prepends '---\n\n'
```

**To add a new setting:** declare it in `devvit.json` under `settings.subreddit`, then read it in the module via `settings.get<T>('key')`. The legacy Redis-backed `settings:*` helpers were removed in 0.0.4.

---

## redis-helper.ts

Post tracking and flood quota evaluation. Owned by flood-moderator.

```typescript
trackPost(userId, postId, createdAt, isModerator, isApprovedUser)
markPostDeleted(postId) / markPostModRemoved(postId) / markPostAutoRemoved(postId)
evaluateFloodStatus(userId, username, maxPosts, windowHours, ignoreSettings, currentPostId?)
```

Redis key schema (legacy — do not change; existing data depends on these exact strings):
- `flood:post:{postId}` — Hash with user/status fields
- `flood:posts` — Global sorted set, score = createdAt ms

New modules should use the standard key format: `<module>:<type>:<scope>`.

---

## When to add a new helper

Add a helper when: the same Redis operation, formatting function, or API wrapper is needed in 2+ module files. If it's only used in one module, keep it in that module file.
