/**
 * One scenario per devvit.json trigger, menu item, form and scheduler task,
 * driven through the shared virtual-Reddit harness. The last test asserts that
 * every declared endpoint was exercised.
 */
import { describe, expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { createApp } from './app';
import { createModTest, expectAllEndpointsCovered } from './test-harness';

const test = createModTest({
  appFactory: createApp,
  settings: {
    botSignature: 'I am a bot.',
    floodModEnabled: false,
    nonresponderModEnabled: false,
    selfResponseModEnabled: false,
    lengthModEnabled: false,
    depthCapModEnabled: false,
  },
});

type FormShape = {
  name: string;
  form: {
    fields: {
      name: string;
      options?: { label: string; value: string }[];
      defaultValue?: unknown;
    }[];
  };
};
function shownForm(res: UiResponse): FormShape {
  const f = (res as { showForm?: FormShape }).showForm;
  if (!f) throw new Error(`expected a form, got ${JSON.stringify(res)}`);
  return f;
}
const toast = (res: UiResponse) => {
  const t = (res as { showToast?: string | { text: string } }).showToast;
  return typeof t === 'string' ? t : t?.text;
};

describe('install, upgrade and modmail', () => {
  test('install, upgrade and an incoming modmail are accepted and do nothing', async ({
    world,
    runner,
  }) => {
    await runner
      .scenario('no-op lifecycle triggers')
      .when('the app is installed', ({ runner: r }) => r.install('modsy'))
      .and('the app is upgraded', ({ runner: r }) => r.upgrade('modsy'))
      .and('a user writes to modmail', ({ runner: r }) =>
        r.userModmails('alice', 'appeal', 'please')
      )
      .then('the app takes no Reddit actions', ({ actions }) => expect(actions).toEqual([]))
      .run();
    expect(world.modmail).toHaveLength(1);
  });
});

describe('report-moderator (onPostReport, onCommentReport)', () => {
  test("reports on other bots' content are ignored; reports on people are left for mods", async ({
    world,
    runner,
  }) => {
    await runner
      .scenario('keep bot output out of the mod queue')
      .given('a define-bot reply and a human reply on a PJW warning post', ({ world: w }) => {
        w.seedPost({ id: 't3_warn', title: 'warning', author: 'predatory-journal-watch' });
        w.seedComment({
          id: 't1_def',
          parentId: 't3_warn',
          body: 'definition',
          author: 'define-bot',
        });
        w.seedComment({ id: 't1_human', parentId: 't3_warn', body: 'opinion', author: 'alice' });
      })
      .when('all three are reported', async ({ runner: r }) => {
        await r.report('t3_warn', 'spam');
        await r.report('t1_def', 'spam');
        await r.report('t1_human', 'spam');
      })
      .then('only the bot content has reports ignored', ({ actions }) => {
        expect(actions.map((a) => `${a.type} ${a.target}`)).toEqual([
          'ignoreReports t3_warn',
          'ignoreReports t1_def',
        ]);
      })
      .run();
    expect(world.comment('t1_human')?.ignoringReports).toBe(false);
  });
});

describe('self-response-moderator (onCommentCreate)', () => {
  test("removes and locks OP's top-level comment and leaves a notice", async ({
    world,
    runner,
    configure,
  }) => {
    configure({
      selfResponseModEnabled: true,
      selfResponseResponse: 'Reply to commenters, not your own post.',
    });
    const post = await runner.userPosts('op', { title: 'Question', selftext: 'hi', url: '' });
    const own = await runner.userComments('op', post.id, 'bump');
    const other = await runner.userComments('bob', post.id, 'answer');

    expect(world.isRemoved(own.id)).toBe(true);
    expect(world.comment(own.id)?.locked).toBe(true);
    expect(world.commentsOn(own.id)[0]?.body).toContain('Reply to commenters');
    expect(world.isRemoved(other.id)).toBe(false);
  });
});

describe('flood-moderator (onPostSubmit, onModAction, onPostDelete) and quota viewer', () => {
  test('second post in the window is removed; mod removal and deletion free the slot', async ({
    world,
    runner,
    configure,
  }) => {
    configure({
      floodModEnabled: true,
      floodAssistantMaxPosts: 1,
      floodAssistantResponse: 'One post per day.',
    });

    const first = await runner.userPosts('alice', { title: 'one', selftext: 'a', url: '' });
    const second = await runner.userPosts('alice', { title: 'two', selftext: 'b', url: '' });
    expect(world.isRemoved(first.id)).toBe(false);
    expect(world.isRemoved(second.id)).toBe(true);
    expect(world.commentsOn(second.id)[0]?.body).toContain('One post per day.');

    // Reddit reports the app's own removal back as a ModAction; the harness does not
    // re-fire triggers for app actions, so deliver it explicitly.
    expect(world.actionsOf('remove').map((a) => a.target)).toEqual([second.id]);
    await runner.modAction('test-app', 'removelink', { targetId: second.id });
    expect(await redis.hGet(`flood:post:${second.id}`, 'isAutoRemoved')).toBe('1');

    // A human mod removes the first post; it no longer counts.
    await runner.modRemoves('modsy', first.id);
    expect(await redis.hGet(`flood:post:${first.id}`, 'isModRemoved')).toBe('1');
    const third = await runner.userPosts('alice', { title: 'three', selftext: 'c', url: '' });
    expect(world.isRemoved(third.id)).toBe(false);

    // OP deletes the third post (source 1 = user); a fourth is allowed.
    await runner.userDeletesPost(third.id);
    expect(await redis.hGet(`flood:post:${third.id}`, 'isUserDeleted')).toBe('1');
    const fourth = await runner.userPosts('alice', { title: 'four', selftext: 'd', url: '' });
    expect(world.isRemoved(fourth.id)).toBe(false);
  });

  test('quota viewer: menu -> search -> result -> search again', async ({
    world,
    runner,
    configure,
  }) => {
    configure({ floodModEnabled: true, floodAssistantMaxPosts: 2 });
    world.mod('modsy');
    await runner.userPosts('alice', { title: 'one', selftext: 'a', url: '' });
    const mod = runner.as('modsy');

    const search = shownForm(
      await mod.menu('quota-viewer', { location: 'subreddit', targetId: world.subreddit().id })
    );
    expect(search.name).toBe('quota-viewer-search');

    const result = shownForm(await mod.form(search.name, { username: 'alice' }));
    expect(result.name).toBe('quota-viewer-result');
    expect(result.form.fields[0]?.defaultValue).toBe('1 / 2 quota posts');

    expect(toast(await mod.form('quota-viewer-search', { username: 'nobody-here' }))).toMatch(
      /not found/
    );
    expect(shownForm(await mod.form('quota-viewer-result', {})).name).toBe('quota-viewer-search');
  });

  test('quota viewer is moderator-only', async ({ world, runner }) => {
    await expect(
      runner
        .as('alice')
        .menu('quota-viewer', { location: 'subreddit', targetId: world.subreddit().id })
    ).rejects.toThrow(/moderator-only/);
  });
});

describe('nonresponder-check (onPostSubmit)', () => {
  test('warns an author who ignored commenters on their last two posts', async ({
    world,
    runner,
    configure,
  }) => {
    configure({ nonresponderModEnabled: true });
    const day = 24 * 60 * 60 * 1000;
    for (const [i, id] of (['t3_old1', 't3_old2'] as const).entries()) {
      world.seedPost({
        id,
        title: `old ${i}`,
        author: 'quiet',
        createdAt: Date.now() - (i + 1) * day,
      });
      for (const who of ['b', 'c', 'd'])
        world.seedComment({ parentId: id, body: `q from ${who}`, author: who });
    }

    const post = await runner.userPosts('quiet', { title: 'new', selftext: 'again', url: '' });
    const [warning] = world.commentsOn(post.id);
    expect(warning?.body).toContain('Responding to commenters is a subreddit rule.');
    expect(warning).toMatchObject({ distinguished: true, stickied: true, locked: true });
    expect(world.actionsOf('report')).toHaveLength(0); // first warning: no escalation
  });

  test('leaves an author alone who replied on a previous post', async ({
    world,
    runner,
    configure,
  }) => {
    configure({ nonresponderModEnabled: true });
    const day = 24 * 60 * 60 * 1000;
    for (const [i, id] of (['t3_old1', 't3_old2'] as const).entries()) {
      world.seedPost({
        id,
        title: `old ${i}`,
        author: 'chatty',
        createdAt: Date.now() - (i + 1) * day,
      });
      for (const who of ['b', 'c', 'd'])
        world.seedComment({ parentId: id, body: `q from ${who}`, author: who });
    }
    const q = world.commentsOn('t3_old1')[0];
    world.seedComment({ parentId: q!.id, body: 'thanks!', author: 'chatty' });

    const post = await runner.userPosts('chatty', { title: 'new', selftext: 'again', url: '' });
    expect(world.commentsOn(post.id)).toEqual([]);
  });
});

describe('flair-transfer (onPostFlairUpdate, flair-transfer-retry scheduler)', () => {
  const POST_FLAIR = { templateId: 'pf-solved', text: 'Solved' };
  const settings = {
    flairTransferEnabled: true,
    flairTransferPostFlairTemplateId: 'pf-solved',
    flairTransferUserFlairTemplateId: 'uf-helper',
    flairTransferRequiredPostCount: 2,
  };

  test('awards the user flair after two qualifying posts', async ({ world, runner, configure }) => {
    configure(settings);
    const a = world.seedPost({ title: 'a', author: 'alice' });
    const b = world.seedPost({ title: 'b', author: 'alice' });

    await runner.flairPost(a.id, POST_FLAIR);
    expect(world.userFlair('alice')).toBeUndefined();
    await runner.flairPost(a.id, POST_FLAIR); // redelivery does not double count
    expect(world.userFlair('alice')).toBeUndefined();
    await runner.flairPost(b.id, POST_FLAIR);
    expect(world.userFlair('alice')?.templateId).toBe('uf-helper');
  });

  test('a failed award is retried by the */5 cron task', async ({
    world,
    runner,
    configure,
    clock,
  }) => {
    configure({ ...settings, flairTransferRequiredPostCount: 1 });
    clock.set('2026-11-25T12:00:30Z');
    const a = world.seedPost({ title: 'a', author: 'alice' });
    vi.mocked(reddit.setUserFlair).mockRejectedValueOnce(new Error('rate limited'));

    await runner.flairPost(a.id, POST_FLAIR);
    expect(world.userFlair('alice')).toBeUndefined();
    expect(await redis.zCard('flair-transfer:retry-queue')).toBe(1);

    // 12:05 runs too early (retry is due 12:05:30); 12:10 retries and succeeds.
    const ran = await runner.advance('10m');
    expect(ran).toEqual(['flair-transfer-retry', 'flair-transfer-retry']);
    expect(world.userFlair('alice')?.templateId).toBe('uf-helper');
    expect(await redis.zCard('flair-transfer:retry-queue')).toBe(0);
  });

  test('mods are never counted', async ({ world, runner, configure }) => {
    configure({ ...settings, flairTransferRequiredPostCount: 1 });
    world.mod('modsy');
    const a = world.seedPost({ title: 'a', author: 'modsy' });
    await runner.flairPost(a.id, POST_FLAIR);
    expect(world.actions).toEqual([]);
  });
});

describe('Chain Mop (menu + form)', () => {
  test('removes and locks a whole comment chain from the comment menu', async ({
    world,
    runner,
  }) => {
    world.mod('modsy');
    const post = world.seedPost({ id: 't3_flame', title: 'thread' });
    const root = world.seedComment({ parentId: post.id, body: 'root', author: 'a' });
    const mid = world.seedComment({ parentId: root.id, body: 'mid', author: 'b' });
    world.seedComment({ parentId: mid.id, body: 'leaf', author: 'a' });
    const sibling = world.seedComment({ parentId: post.id, body: 'unrelated', author: 'c' });
    const mod = runner.as('modsy');

    const form = shownForm(await mod.menu('chain-mop', { location: 'comment', targetId: root.id }));
    expect(form.name).toBe('chain-mop');
    const res = await mod.form(form.name, { remove: true, lock: true, skipDistinguished: false });

    expect(toast(res)).toBe('Removed 3 comments, locked 3 comments.');
    expect(world.actionsOf('remove')).toHaveLength(3);
    expect(world.isRemoved(sibling.id)).toBe(false);
    expect(world.modNotes.map((n) => n.redditId)).toEqual([root.id]);
  });

  test('without a session the form says so', async ({ world, runner }) => {
    world.mod('modsy');
    const res = await runner
      .as('modsy')
      .form('chain-mop', { remove: true, lock: false, skipDistinguished: false });
    expect(toast(res)).toBe('Session expired. Try again.');
  });
});

describe('Saved Responses (subreddit menu, post/comment menu, 8 forms)', () => {
  test('add, apply with macros, edit and delete a saved response', async ({ world, runner }) => {
    world.mod('modsy');
    const mod = runner.as('modsy');
    const sub = { location: 'subreddit', targetId: world.subreddit().id };
    const post = world.seedPost({
      title: 'Help',
      author: 'alice',
      flair: { templateId: 'q', text: 'Question' },
    });

    // Add.
    const manage = shownForm(await mod.menu('saved-responses', sub));
    expect(manage.name).toBe('saved-response-manage');
    const add = shownForm(await mod.form(manage.name, { action: ['new'] }));
    expect(add.name).toBe('saved-response-add');
    expect(
      toast(
        await mod.form(add.name, {
          title: 'Rule 1',
          body: 'Hi {get_username}, see {modmail}.',
          location: ['both'],
        })
      )
    ).toBe('Saved response "Rule 1" added.');

    // Apply on a post via the post menu.
    const select = shownForm(
      await mod.menu('apply-saved-response', { location: 'post', targetId: post.id })
    );
    expect(select.name).toBe('saved-response-select');
    const responseId = select.form.fields[0]?.options?.[0]?.value as string;
    const apply = shownForm(await mod.form(select.name, { responseId: [responseId] }));
    expect(apply.name).toBe('saved-response-apply');
    const message = apply.form.fields.find((f) => f.name === 'message')?.defaultValue as string;
    await mod.form(apply.name, { message, lock: true, distinguish: true, commenter: ['app'] });

    const [reply] = world.commentsOn(post.id);
    expect(reply?.body).toContain(
      'Hi u/alice, see [modmail](https://www.reddit.com/message/compose?to=/r/testsub).'
    );
    expect(reply?.distinguished).toBe(true);
    expect(world.post(post.id)?.locked).toBe(true);

    // Edit.
    const edit = shownForm(await mod.form(manage.name, { action: ['edit'] }));
    expect(edit.name).toBe('saved-response-edit-select');
    const editApply = shownForm(await mod.form(edit.name, { responseId: [responseId] }));
    expect(editApply.name).toBe('saved-response-edit-apply');
    expect(
      toast(
        await mod.form(editApply.name, { title: 'Rule 1b', body: 'Edited', location: ['comment'] })
      )
    ).toBe('Saved response "Rule 1b" updated.');

    // Now comment-only: a post has no responses to offer.
    expect(
      toast(await mod.menu('apply-saved-response', { location: 'post', targetId: post.id }))
    ).toMatch(/No saved responses for posts/);

    // Delete.
    const del = shownForm(await mod.form(manage.name, { action: ['delete'] }));
    expect(del.name).toBe('saved-response-delete');
    expect(toast(await mod.form(del.name, { responseId: [responseId] }))).toBe(
      'Saved response "Rule 1b" deleted.'
    );
    expect(toast(await mod.form(manage.name, { action: ['edit'] }))).toBe(
      'No saved responses yet.'
    );
  });

  test('a moderator can post a saved response as themselves on a comment', async ({
    world,
    runner,
  }) => {
    world.mod('modsy');
    const mod = runner.as('modsy');
    const post = world.seedPost({ title: 'p', author: 'op' });
    const c = world.seedComment({ parentId: post.id, body: 'rude', author: 'bob' });
    await mod.form('saved-response-add', {
      title: 'Civility',
      body: 'Be civil.',
      location: ['comment'],
    });

    const select = shownForm(
      await mod.menu('apply-saved-response', { location: 'comment', targetId: c.id })
    );
    const responseId = select.form.fields[0]?.options?.[0]?.value as string;
    await mod.form(select.name, { responseId: [responseId] });
    await mod.form('saved-response-apply', {
      message: 'Be civil.',
      lock: true,
      distinguish: true,
      commenter: ['user'],
    });

    const [reply] = world.commentsOn(c.id);
    expect(reply?.authorName).toBe('modsy');
    expect(reply?.distinguished).toBe(false); // only app comments are distinguished
    expect(world.comment(c.id)?.locked).toBe(true);
  });
});

// Keep last.
test('every devvit.json endpoint has a scenario', () => {
  expectAllEndpointsCovered();
});
