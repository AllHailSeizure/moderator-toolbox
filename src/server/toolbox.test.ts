import { readFileSync } from 'node:fs';
import { describe, expect } from 'vitest';
import { redis } from '@devvit/web/server';
import { createApp } from './app';
import { createModTest, type FakeRedditWorld } from './test-harness';

const SIGNATURE = 'I am a bot.';

const test = createModTest({
  appFactory: createApp,
  settings: {
    botSignature: SIGNATURE,
    // Modules sharing a trigger with the one under test stay off unless a test turns them on.
    floodModEnabled: false,
    nonresponderModEnabled: false,
    selfResponseModEnabled: false,
    lengthModEnabled: false,
    depthCapModEnabled: false,
    depthCapIgnoreModerators: false,
    depthCapIgnoreContributors: false,
  },
});

type Devvit = {
  triggers: Record<string, string>;
  menu: { items: { endpoint: string }[] };
  forms: Record<string, string>;
  scheduler: { tasks: Record<string, { endpoint: string }> };
  permissions: { http: { domains: string[] } };
  settings: { global: Record<string, unknown>; subreddit: Record<string, { label: string }> };
};
const devvit = JSON.parse(
  readFileSync(new URL('../../devvit.json', import.meta.url), 'utf8')
) as Devvit;

// Every test also fails on any outbound fetch: the harness's FakeHttp has no stubs here.

describe('report-moderator (STATIC_BOT_AUTHORS)', () => {
  for (const author of [
    'predatory-journal-watch',
    'define-bot',
    'AutoModerator',
    'FloodAssistant',
    'test-app',
  ]) {
    test(`ignores reports on comments by ${author}`, async ({ world, runner }) => {
      const post = world.seedPost({ id: 't3_p', title: 'p' });
      const c = world.seedComment({ id: 't1_bot', parentId: post.id, body: 'beep', author });
      await runner.report(c.id, 'spam');
      expect(world.describeActions()).toEqual(['test-app ignoreReports t1_bot']);
      expect(await redis.get('bot:rf:comment:t1_bot')).toBe('1');
    });
  }

  test('leaves reports on human comments alone', async ({ world, runner }) => {
    const post = world.seedPost({ id: 't3_p', title: 'p' });
    world.seedComment({ id: 't1_h', parentId: post.id, body: 'hi', author: 'alice' });
    await runner.report('t1_h', 'spam');
    expect(world.actions).toEqual([]);
    expect(await redis.get('bot:rf:comment:t1_h')).toBeUndefined();
  });

  test('dedupes a repeated report trigger', async ({ world, runner }) => {
    const post = world.seedPost({ id: 't3_p', title: 'p' });
    world.seedComment({ id: 't1_bot', parentId: post.id, body: 'x', author: 'define-bot' });
    await runner.report('t1_bot', 'spam');
    await runner.report('t1_bot', 'rude');
    expect(world.actionsOf('ignoreReports')).toHaveLength(1);
  });

  test('ignores reports on posts by the split-out apps', async ({ world, runner }) => {
    world.seedPost({ id: 't3_p', title: 'warning', author: 'predatory-journal-watch' });
    await runner.report('t3_p', 'x');
    expect(world.post('t3_p')?.ignoringReports).toBe(true);
    expect(await redis.get('bot:rf:post:t3_p')).toBe('1');
  });
});

describe('depth-cap-moderator', () => {
  /** t3_p <- c1 (a) <- c2 (b); returns c2's id. */
  const chain = (world: FakeRedditWorld) => {
    world.seedPost({ id: 't3_p', title: 'p', author: 'op' });
    world.seedComment({ id: 't1_c1', parentId: 't3_p', body: '1', author: 'a' });
    return world.seedComment({ id: 't1_c2', parentId: 't1_c1', body: '2', author: 'b' }).id;
  };

  test('replies, locks and reports the comment that reaches the cap', async ({
    world,
    runner,
    configure,
  }) => {
    configure({ depthCapModEnabled: true, depthCap: 3 });
    const c3 = await runner.userComments('a', chain(world), 'reply');

    const replies = world.commentsOn(c3.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toContain('maximum comment depth');
    expect(replies[0]?.body).toContain('^I ^am ^a ^bot.');
    expect(replies[0]).toMatchObject({ locked: true, distinguished: true });
    expect(world.comment(c3.id)?.locked).toBe(true);
    expect(world.actionsOf('report').map((a) => a.target)).toEqual([c3.id]);
    expect(await redis.get(`bot:dcmod:handled:${c3.id}`)).toBe('1');
    expect(await redis.zCard('bot:chainmod:depth-log')).toBe(1);
  });

  test('does nothing below the cap', async ({ world, runner, configure }) => {
    configure({ depthCapModEnabled: true, depthCap: 3 });
    chain(world);
    await runner.userComments('a', 't3_p', 'top-level');
    expect(world.actions).toEqual([]);
  });

  test('skips moderators when depthCapIgnoreModerators is on', async ({
    world,
    runner,
    configure,
  }) => {
    configure({ depthCapModEnabled: true, depthCap: 3, depthCapIgnoreModerators: true });
    const parent = chain(world);
    world.mod('modsy');
    await runner.userComments('modsy', parent, 'mod reply');
    expect(world.actions).toEqual([]);
  });

  test('does nothing when disabled', async ({ world, runner }) => {
    const c3 = await runner.userComments('a', chain(world), 'reply');
    expect(world.actions).toEqual([]);
    expect(await redis.get(`bot:dcmod:handled:${c3.id}`)).toBeUndefined();
  });
});

describe('length-moderator', () => {
  const restricted = { templateId: 'flair-1', text: 'Theory' };

  test('removes, locks and explains an over-long post with the restricted flair', async ({
    world,
    runner,
    configure,
  }) => {
    configure({
      lengthModEnabled: true,
      lengthModFlairId: 'flair-1',
      lengthModMaxUnhostedLength: 10,
      lengthModMaxUnhostedComment: 'Too long, host it elsewhere.',
    });
    const post = await runner.userPosts('alice', {
      title: 'Long',
      selftext: 'x'.repeat(50),
      flair: restricted,
    });
    expect(world.isRemoved(post.id)).toBe(true);
    expect(world.post(post.id)?.locked).toBe(true);
    const replies = world.commentsOn(post.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toBe('Too long, host it elsewhere.\n\n---\n\n^I ^am ^a ^bot.');
    expect(replies[0]).toMatchObject({ stickied: true, locked: true });
  });

  test('leaves a short post alone', async ({ world, runner, configure }) => {
    configure({
      lengthModEnabled: true,
      lengthModFlairId: 'flair-1',
      lengthModMaxUnhostedLength: 100,
    });
    const post = await runner.userPosts('alice', {
      title: 'Short',
      selftext: 'short',
      flair: restricted,
    });
    expect(world.isRemoved(post.id)).toBe(false);
    expect(world.actions).toEqual([]);
  });

  test('enforces when the restricted flair is applied later', async ({
    world,
    runner,
    configure,
  }) => {
    configure({
      lengthModEnabled: true,
      lengthModFlairId: 'flair-1',
      lengthModMaxUnhostedLength: 10,
    });
    const post = await runner.userPosts('alice', { title: 'Long', selftext: 'y'.repeat(40) });
    expect(world.isRemoved(post.id)).toBe(false);

    await runner.flairPost(post.id, restricted);
    expect(world.isRemoved(post.id)).toBe(true);
    expect(world.post(post.id)?.locked).toBe(true);
  });
});

describe('extracted modules are gone', () => {
  test('a !define comment gets no reply and makes no network call', async ({
    world,
    runner,
    http,
  }) => {
    world.seedPost({ id: 't3_p', title: 'p' });
    await runner.userComments('alice', 't3_p', 'u/moderator-toolbox !define entropy');
    expect(world.actions).toEqual([]);
    expect(http.calls).toEqual([]);
  });

  test('a post with a DOI gets no predatory-journal reply', async ({ world, runner, http }) => {
    await runner.userPosts('alice', {
      title: 'Paper',
      selftext: 'https://doi.org/10.1234/abc',
      url: '',
    });
    expect(world.actions).toEqual([]);
    expect(http.calls).toEqual([]);
  });
});

describe('devvit.json', () => {
  test('drops the extracted global settings and domains', () => {
    const keys = [
      ...Object.keys(devvit.settings.global),
      ...Object.keys(devvit.settings.subreddit),
    ];
    expect(keys.filter((k) => /^(predatoryWatch|defineCommand)/.test(k))).toEqual([]);
    expect(devvit.settings.global).not.toHaveProperty('geminiApiKey');
    expect(devvit.settings.global).not.toHaveProperty('supabaseFunctionToken');
    expect(devvit.permissions.http.domains).toEqual(['eimdgqymjwfljtapnuyl.supabase.co']);
    for (const s of Object.values(devvit.settings.subreddit)) expect(s.label).not.toMatch(/â€/);
  });

  test('every declared endpoint is served by the app', async () => {
    const app = createApp();
    const endpoints = [
      ...Object.values(devvit.triggers),
      ...devvit.menu.items.map((i) => i.endpoint),
      ...Object.values(devvit.forms),
      ...Object.values(devvit.scheduler.tasks).map((t) => t.endpoint),
    ];
    expect(endpoints.length).toBeGreaterThan(20);
    for (const path of endpoints) {
      const res = await app.fetch(
        new Request(`http://localhost${path}`, { method: 'POST', body: '{}' })
      );
      expect(res.status, path).not.toBe(404);
    }
  });
});
