import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesNativeSource } from './source.js';
import {
  ProfileConversations,
  conversationIdentity,
  profileConversationId,
} from './profile-conversations.js';

afterEach(() => vi.restoreAllMocks());
const command = {
  mode: 'execute' as const,
  actor: { type: 'service' as const, id: 'unify-core' },
  requestId: 'r',
  correlationId: 'c',
  idempotencyKey: 'k',
};
function fixture(persist = true) {
  let completed = false;
  const store = vi
    .spyOn(ProfileConversations.prototype, 'run')
    .mockImplementation(async (profile, mode, payload: any) => {
      if (mode === 'configuration') return { model: 'configured-model' };
      if (mode === 'list') return [{ id: 'same', source: 'api_server', title: profile }];
      if (mode === 'create')
        return { session: { id: 'same', source: 'api_server', title: payload.title } };
      if (payload.id === 'external') throw Error('External channel');
      if (mode === 'get') return { session: { id: payload.id, source: 'api_server' } };
      return {
        data:
          completed && persist
            ? [{ id: 'reply', role: 'assistant', content: profile + ' response' }]
            : [],
      };
    });
  const run = vi.fn(async (args: string[], options?: any) => {
    if (args.join(' ') === 'profile list')
      return 'alpha configured-model stopped\nbeta configured-model stopped';
    if (args[0] === 'profile') return '';
    if (args[0] === 'chat') {
      expect(options.profileId).toBe('alpha');
      completed = true;
      return 'CLI acknowledgement';
    }
    throw Error('Unexpected command');
  });
  const fetch = vi.fn(async () =>
    Response.json({ sessions: [{ id: 'same', source: 'api_server', title: 'default' }] }),
  );
  return {
    source: new HermesNativeSource({
      runner: { run },
      apiBaseUrl: 'https://hermes.test',
      fetchImpl: fetch,
    }),
    run,
    store,
    fetch,
  };
}
describe('native profile conversation routing', () => {
  it('qualifies identities without aliases or traversal', () => {
    expect(conversationIdentity('legacy')).toEqual({ profile: 'default', nativeId: 'legacy' });
    expect(conversationIdentity(profileConversationId('alpha', 'same'))).toEqual({
      profile: 'alpha',
      nativeId: 'same',
    });
    for (const bad of ['p:default:same', 'p:../root:same', 'p:alpha:../same', 'p:alpha:one:two'])
      expect(() => conversationIdentity(bad)).toThrow();
  });
  it('keeps duplicate native IDs distinct across profile stores', async () => {
    const { source } = fixture();
    expect((await source.sessions()).items.map((x) => x.id)).toEqual([
      'same',
      'p:alpha:same',
      'p:beta:same',
    ]);
  });
  it('creates in the selected profile and never sends profile hints to the unscoped API', async () => {
    const { source, store, fetch } = fixture();
    const r = await source.executeConversation({
      ...command,
      operation: 'session.create',
      targetId: 'new',
      payload: { title: 'owned', profileId: 'alpha' },
    });
    expect(r.session).toMatchObject({ id: 'p:alpha:same' });
    expect(store).toHaveBeenCalledWith(
      'alpha',
      'create',
      expect.objectContaining({ key: 'k', title: 'owned' }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('resumes the exact native ID through the profile-scoped CLI and reads that profile back', async () => {
    const { source, run, fetch } = fixture();
    const r = await source.executeConversation({
      ...command,
      operation: 'message.send',
      targetId: 'p:alpha:same',
      payload: { message: 'hello' },
    });
    expect(r.message).toMatchObject({ content: 'alpha response', sessionId: 'p:alpha:same' });
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining(['--resume', 'same', '--source', 'api_server']),
      expect.objectContaining({ profileId: 'alpha' }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not convert an empty CLI acknowledgement into model success', async () => {
    const { source } = fixture(false);
    await expect(
      source.executeConversation({
        ...command,
        operation: 'message.send',
        targetId: 'p:alpha:same',
        payload: { message: 'hello' },
      }),
    ).rejects.toThrow('did not persist');
  });
  it('never executes an externally-owned session or forwards unsupported attachments to the default runtime', async () => {
    const { source, run, fetch } = fixture();
    await expect(
      source.executeConversation({
        ...command,
        operation: 'message.send',
        targetId: 'p:alpha:external',
        payload: { message: 'hello' },
      }),
    ).rejects.toThrow('External');
    await expect(
      source.executeConversation({
        ...command,
        operation: 'message.send',
        targetId: 'p:alpha:same',
        payload: { message: [{ type: 'text', text: 'hello' }] },
      }),
    ).rejects.toThrow('text message');
    expect(run).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
