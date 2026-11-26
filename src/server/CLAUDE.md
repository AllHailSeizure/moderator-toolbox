# Server Module Standards

Every module must export a `MODULE` descriptor. Every module must use the `logger()` helper. See `.claude/CLAUDE.md` for the full naming standards.

---

## MODULE descriptor (required in every module file)

```typescript
import { logger } from '../helpers/logger';

export const MODULE = {
  name: 'my-module',              // kebab-case, matches file name
  type: 'trigger',                // 'trigger' | 'action' | 'scheduler'
  description: 'One sentence describing what this module does.',
  triggers: ['onPostSubmit'],     // Devvit event names; [] for action/scheduler
  redisKeys: [                    // every key the module reads or writes
    'my-module:count:user:{userId}',
  ],
  settings: ['myModuleEnabled'], // every setting key the module reads
} as const;

const log = logger(MODULE.name);  // always bind to MODULE.name, never a string literal
```

---

## Trigger module (`trigger-modules/`)

```typescript
export const MODULE = { name: 'my-module', type: 'trigger', ... } as const;
const log = logger(MODULE.name);

export async function run(event: OnPostSubmitRequest): Promise<void> {
  const enabled = (await settings.get<boolean>('myModuleEnabled')) ?? true;
  if (!enabled) return;          // always first

  log.info('post_submit', { postId: event.post.id, userId: event.author.id });
  // ... logic
}
```

Register in `registry.ts`:
```typescript
import { run as myModule } from './trigger-modules/my-module';
const POST_SUBMIT: PostSubmitHandler[] = [...existing, myModule];
```

---

## Action module (`action-modules/`)

```typescript
export const MODULE = { name: 'my-module', type: 'action', ... } as const;
const log = logger(MODULE.name);

export function register(app: Hono): void {
  app.post('/internal/menu/my-module', async (c) => {
    const enabled = (await settings.get<boolean>('myModuleEnabled')) ?? true;
    if (!enabled) return c.json({ showToast: { text: 'My Module is disabled.', appearance: 'neutral' } });
    // ...
  });
  app.post('/internal/forms/my-module', async (c) => { /* handle form */ });
}
```

Also requires `devvit.json` entries under `menu.items` and `forms`.

Register in `registry.ts`: `registerMyModule(app);` inside `registerAll()`.

---

## Settings naming (mandatory)

Declare settings in `devvit.json` `settings.subreddit` with camelCase keys: `<module>Enabled` for the toggle (e.g. `floodModEnabled`), `<module><Noun>` for sub-settings (e.g. `floodModMaxPosts`). Read with `settings.get<T>()`.

---

## Toast messages (mandatory)

```typescript
// Always object form. Always complete sentence ending with period.
return c.json({ showToast: { text: 'Removed 2 comments.', appearance: 'success' } });
return c.json({ showToast: { text: 'My Module is disabled. Enable it in bot settings.', appearance: 'critical' } });
```

Appearance values: `'success'` | `'neutral'` | `'critical'`

---

## Logging (mandatory)

```typescript
log.info('event_name', { userId, postId, action: 'removed', reason: 'quota_exceeded' });
log.warn('unexpected_state', { detail });
log.error('handler_failed', err, { context });
```

First arg is always a snake_case event name. Second arg is the data object. Never use freeform string-only messages in module code.

---

## Before promoting to publish

Add or update a FakeRedditWorld test (`src/server/*.test.ts`) and run `npm run check`. Publishing is done by Nate through the release workflow.
