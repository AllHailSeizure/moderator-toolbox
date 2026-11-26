import { readFileSync } from 'node:fs';
import { describe, expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/web/shared';
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

/** Nothing in these tests may reach the network (Reddit, Supabase, Gemini, Wikipedia). */
function blockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    throw new Error(`unexpected fetch ${String(input)}`);
  });
}

type FakeComment = { id: T1; parentId: T1 | T3; authorName: string; locked: boolean };

function installComments(world: FakeRedditWorld, comments: FakeComment[]) {
  const ignored: string[] = [];
  const locked: string[] = [];
  vi.spyOn(reddit, 'getCommentById').mockImplementation((async (id: T1) => {
    const c = comments.find((x) => x.id === id);
    if (!c) throw new Error(`no comment ${id}`);
    return {
      ...c,
      ignoreReports: async () => {
        ignored.push(id);
      },
      lock: async () => {
        c.locked = true;
        locked.push(id);
      },
      reply: (opts: { text: string }) => reddit.submitComment({ id, text: opts.text }),
    };
  }) as unknown as typeof reddit.getCommentById);
  void world;
  return { ignored, locked };
}

const commentReport = (id: T1) => ({ type: 'CommentReport', comment: { id }, reason: 'spam' });

describe('report-moderator (STATIC_BOT_AUTHORS)', () => {
  for (const author of [
    'predatory-journal-watch',
    'define-bot',
    'AutoModerator',
    'FloodAssistant',
    'test-app',
  ]) {
    test(`ignores reports on comments by ${author}`, async ({ world, runner }) => {
      blockFetch();
      const { ignored } = installComments(world, [
        { id: 't1_bot', parentId: 't3_p', authorName: author, locked: false },
      ]);
      await runner.trigger('comment-report', commentReport('t1_bot'));
      expect(ignored).toEqual(['t1_bot']);
      expect(await redis.get('bot:rf:comment:t1_bot')).toBe('1');
    });
  }

  test('leaves reports on human comments alone', async ({ world, runner }) => {
    blockFetch();
    const { ignored } = installComments(world, [
      { id: 't1_h', parentId: 't3_p', authorName: 'alice', locked: false },
    ]);
    await runner.trigger('comment-report', commentReport('t1_h'));
    expect(ignored).toEqual([]);
    expect(await redis.get('bot:rf:comment:t1_h')).toBeUndefined();
  });

  test('dedupes a repeated report trigger', async ({ world, runner }) => {
    blockFetch();
    const { ignored } = installComments(world, [
      { id: 't1_bot', parentId: 't3_p', authorName: 'define-bot', locked: false },
    ]);
    await runner.trigger('comment-report', commentReport('t1_bot'));
    await runner.trigger('comment-report', commentReport('t1_bot'));
    expect(ignored).toEqual(['t1_bot']);
  });

  test('ignores reports on posts by the split-out apps', async ({ runner }) => {
    blockFetch();
    const ignored: string[] = [];
    vi.spyOn(reddit, 'getPostById').mockImplementation((async (id: T3) => ({
      id,
      authorName: 'predatory-journal-watch',
      ignoreReports: async () => {
        ignored.push(id);
      },
    })) as unknown as typeof reddit.getPostById);
    await runner.trigger('post-report', { type: 'PostReport', post: { id: 't3_p' }, reason: 'x' });
    expect(ignored).toEqual(['t3_p']);
    expect(await redis.get('bot:rf:post:t3_p')).toBe('1');
  });
});

describe('depth-cap-moderator', () => {
  const chain = (): FakeComment[] => [
    { id: 't1_c1', parentId: 't3_p', authorName: 'a', locked: false },
    { id: 't1_c2', parentId: 't1_c1', authorName: 'b', locked: false },
    { id: 't1_c3', parentId: 't1_c2', authorName: 'a', locked: false },
  ];
  const created = (id: T1, parentId: T1 | T3) => ({
    type: 'CommentCreate',
    comment: { id, parentId, postId: 't3_p', author: 't2_a', body: 'reply' },
    post: { id: 't3_p' },
    subreddit: { name: 'testsub' },
  });

  test('replies, locks and reports the comment that reaches the cap', async ({
    world,
    runner,
    mocks,
  }) => {
    blockFetch();
    mocks.settings.update({ depthCapModEnabled: true, depthCap: 3 });
    const comments = chain();
    const { locked } = installComments(world, comments);
    const report = vi.spyOn(reddit, 'report').mockResolvedValue(undefined as never);

    await runner.trigger('comment-create', created('t1_c3', 't1_c2'));

    const replies = world.commentsOn('t1_c3');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toContain('maximum comment depth');
    expect(replies[0]?.body).toContain('^I ^am ^a ^bot.');
    expect(replies[0]?.locked).toBe(true);
    expect(replies[0]?.distinguished).toBe(true);
    expect(locked).toEqual(['t1_c3']);
    expect(report).toHaveBeenCalledTimes(1);
    expect(await redis.get('bot:dcmod:handled:t1_c3')).toBe('1');
    expect(await redis.zCard('bot:chainmod:depth-log')).toBe(1);
  });

  test('does nothing below the cap', async ({ world, runner, mocks }) => {
    blockFetch();
    mocks.settings.update({ depthCapModEnabled: true, depthCap: 3 });
    const { locked } = installComments(world, chain());
    await runner.trigger('comment-create', created('t1_c2', 't1_c1'));
    expect(world.comments).toHaveLength(0);
    expect(locked).toEqual([]);
  });

  test('does nothing when disabled', async ({ world, runner }) => {
    blockFetch();
    const { locked } = installComments(world, chain());
    await runner.trigger('comment-create', created('t1_c3', 't1_c2'));
    expect(world.comments).toHaveLength(0);
    expect(locked).toEqual([]);
    expect(await redis.get('bot:dcmod:handled:t1_c3')).toBeUndefined();
  });
});

describe('length-moderator', () => {
  function installPost(world: FakeRedditWorld, flairId: string) {
    const lock = vi.fn(async () => {});
    vi.spyOn(reddit, 'getPostById').mockImplementation((async (id: T3) => ({
      id,
      flair: { templateId: flairId },
      lock,
      addComment: (opts: { text: string }) => reddit.submitComment({ id, text: opts.text }),
    })) as unknown as typeof reddit.getPostById);
    world.seedPost({ id: 't3_long', title: 'Long' });
    return lock;
  }
  const submit = (selftext: string, url = '') => ({
    type: 'PostSubmit',
    post: { id: 't3_long', title: 'Long', selftext, url },
    author: { id: 't2_a', name: 'alice' },
  });

  test('removes, locks and explains an over-long post with the restricted flair', async ({
    world,
    runner,
    mocks,
  }) => {
    blockFetch();
    mocks.settings.update({
      lengthModEnabled: true,
      lengthModFlairId: 'flair-1',
      lengthModMaxUnhostedLength: 10,
      lengthModMaxUnhostedComment: 'Too long, host it elsewhere.',
    });
    const lock = installPost(world, 'flair-1');
    await runner.trigger('post-submit', submit('x'.repeat(50)));
    expect(world.isRemoved('t3_long')).toBe(true);
    expect(lock).toHaveBeenCalled();
    const replies = world.commentsOn('t3_long');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toBe('Too long, host it elsewhere.\n\n---\n\n^I ^am ^a ^bot.');
    expect(replies[0]?.stickied).toBe(true);
  });

  test('leaves a short post alone', async ({ world, runner, mocks }) => {
    blockFetch();
    mocks.settings.update({
      lengthModEnabled: true,
      lengthModFlairId: 'flair-1',
      lengthModMaxUnhostedLength: 100,
    });
    installPost(world, 'flair-1');
    await runner.trigger('post-submit', submit('short'));
    expect(world.isRemoved('t3_long')).toBe(false);
    expect(world.comments).toHaveLength(0);
  });
});

describe('extracted modules are gone', () => {
  test('a !define comment gets no reply and makes no network call', async ({ world, runner }) => {
    const fetchSpy = blockFetch();
    installComments(world, []);
    await runner.trigger('comment-create', {
      type: 'CommentCreate',
      comment: {
        id: 't1_d',
        parentId: 't3_p',
        postId: 't3_p',
        author: 't2_a',
        body: 'u/moderator-toolbox !define entropy',
      },
      post: { id: 't3_p' },
      author: { name: 'alice' },
    });
    expect(world.comments).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a post with a DOI gets no predatory-journal reply', async ({ world, runner }) => {
    const fetchSpy = blockFetch();
    await runner.trigger('post-submit', {
      type: 'PostSubmit',
      post: { id: 't3_doi', title: 'Paper', selftext: 'https://doi.org/10.1234/abc', url: '' },
      author: { id: 't2_a', name: 'alice' },
    });
    expect(world.comments).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('devvit.json', () => {
  test('drops the extracted settings, secrets and domains', () => {
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
    blockFetch();
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
