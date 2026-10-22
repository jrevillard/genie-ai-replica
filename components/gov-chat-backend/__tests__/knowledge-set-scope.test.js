'use strict';

/**
 * Knowledge Set scope of a chat turn: which documents chatqna may use for a
 * Topic Module (twin), and that the scope reaches the chatqna payload.
 */

jest.mock(
  '../shared-lib',
  () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    dbService: { getConnection: jest.fn() },
    ensureCollection: jest.fn()
  }),
  { virtual: true }
);
jest.mock('arangojs', () => ({ aql: jest.fn(() => ({})) }));

const mockGetTwinByKey = jest.fn();
jest.mock('../services/ai-twin-service', () => ({
  getTwinByKey: (...args) => mockGetTwinByKey(...args),
  buildTwinPromptFragment: () => null
}));

const { logger } = require('../shared-lib');
const {
  NO_KNOWLEDGE_SET_FILE_ID,
  EMPTY_KNOWLEDGE_SET_SCOPES,
  readEmptyKnowledgeSetScope,
  knowledgeSetScope
} = require('../services/knowledge-set-scope');
const chatSessionService = require('../services/chat-session-service');
const queryService = require('../services/query-service');

const { NONE, ALL } = EMPTY_KNOWLEDGE_SET_SCOPES;
const KNOWLEDGE_SET = ['1730000000000_a1b2c3d4', '1730000000001_b2c3d4e5'];

describe('knowledgeSetScope', () => {
  it.each([NONE, ALL])('a twin with a Knowledge Set is scoped to its files (%s)', (emptyScope) => {
    expect(knowledgeSetScope({ linkedKbFileIds: KNOWLEDGE_SET }, emptyScope)).toEqual(KNOWLEDGE_SET);
  });

  it.each([[{ linkedKbFileIds: [] }], [{ linkedKbFileIds: null }], [{}]])(
    'a twin without a Knowledge Set matches no file by default (%j)',
    (twin) => {
      expect(knowledgeSetScope(twin, NONE)).toEqual([NO_KNOWLEDGE_SET_FILE_ID]);
    }
  );

  it('a twin without a Knowledge Set searches every document under ALL', () => {
    expect(knowledgeSetScope({ linkedKbFileIds: [] }, ALL)).toEqual([]);
  });

  it.each([NONE, ALL])('no twin (none on the session, or the lookup failed) searches unscoped (%s)', (emptyScope) => {
    expect(knowledgeSetScope(null, emptyScope)).toEqual([]);
  });

  it('a missing setting matches no file', () => {
    expect(knowledgeSetScope({ linkedKbFileIds: [] }, undefined)).toEqual([NO_KNOWLEDGE_SET_FILE_ID]);
  });

  it('the no-file id cannot be a document-repository file id', () => {
    // document-repository generateUniqueFileId(): `<Date.now()>_<8 hex>`; a uuid v4 elsewhere.
    expect(NO_KNOWLEDGE_SET_FILE_ID).not.toMatch(/^\d+_[0-9a-f]{8}$/i);
    expect(NO_KNOWLEDGE_SET_FILE_ID).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // chatqna trims ids and ignores blank ones.
    expect(NO_KNOWLEDGE_SET_FILE_ID.trim()).toBe(NO_KNOWLEDGE_SET_FILE_ID);
    expect(NO_KNOWLEDGE_SET_FILE_ID).not.toBe('');
  });
});

describe('readEmptyKnowledgeSetScope', () => {
  beforeEach(() => logger.warn.mockClear());

  it.each([
    [{}],
    [{ EMPTY_KNOWLEDGE_SET_SCOPE: '' }],
    [{ EMPTY_KNOWLEDGE_SET_SCOPE: 'none' }],
    [{ EMPTY_KNOWLEDGE_SET_SCOPE: ' None ' }]
  ])('%j means NONE, without a warning', (env) => {
    expect(readEmptyKnowledgeSetScope(env)).toBe(NONE);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(['all', ' ALL '])('"%s" means ALL', (value) => {
    expect(readEmptyKnowledgeSetScope({ EMPTY_KNOWLEDGE_SET_SCOPE: value })).toBe(ALL);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('an unknown value means NONE and is logged once', () => {
    const env = { EMPTY_KNOWLEDGE_SET_SCOPE: 'everything' };
    expect(readEmptyKnowledgeSetScope(env)).toBe(NONE);
    expect(readEmptyKnowledgeSetScope(env)).toBe(NONE);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('EMPTY_KNOWLEDGE_SET_SCOPE');
  });
});

describe('ChatSessionService.sendMessage -> chatqna payload', () => {
  const saved = {
    scope: process.env.EMPTY_KNOWLEDGE_SET_SCOPE,
    contextOption: process.env.CONTEXT_OPTION
  };
  const runOPEAWorker = jest.fn();

  function restoreEnv(name, value) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  beforeAll(() => {
    // Real QueryService.executeChatqnaTurn; only the database and the OPEA call are stubbed.
    delete process.env.CONTEXT_OPTION;
    Object.assign(queryService, {
      db: { query: jest.fn(async () => ({ next: async () => null, all: async () => [] })) },
      queries: {
        save: jest.fn(async () => ({ _key: 'q1' })),
        update: jest.fn(async () => ({})),
        document: jest.fn(async () => ({}))
      },
      serviceCategories: {},
      services: {},
      analyticsService: null,
      runOPEAWorker
    });
    chatSessionService.setQueryService(queryService);
    chatSessionService.getSessionForUser = jest.fn(async () => ({ _key: 's1', userId: 'u1', twinId: 'twin-1' }));
    chatSessionService.getRecentMessagesChronological = jest.fn(async () => []);
    chatSessionService.appendMessage = jest.fn(async () => 'm1');
  });

  afterAll(() => {
    restoreEnv('EMPTY_KNOWLEDGE_SET_SCOPE', saved.scope);
    restoreEnv('CONTEXT_OPTION', saved.contextOption);
  });

  beforeEach(() => {
    delete process.env.EMPTY_KNOWLEDGE_SET_SCOPE;
    mockGetTwinByKey.mockReset();
    runOPEAWorker.mockReset();
    runOPEAWorker.mockResolvedValue({ response: 'ok', metadata: {}, responseTime: 1 });
  });

  async function chatqnaContext() {
    await chatSessionService.sendMessage('u1', 's1', 'What is high blood pressure?', {});
    expect(runOPEAWorker).toHaveBeenCalledTimes(1);
    return runOPEAWorker.mock.calls[0][1].context;
  }

  it('twin with a Knowledge Set: scoped to its files', async () => {
    mockGetTwinByKey.mockResolvedValue({ _key: 'twin-1', linkedKbFileIds: KNOWLEDGE_SET });
    expect((await chatqnaContext()).kbFileIds).toEqual(KNOWLEDGE_SET);
  });

  it('twin without a Knowledge Set: scoped to no file', async () => {
    mockGetTwinByKey.mockResolvedValue({ _key: 'twin-1', linkedKbFileIds: [] });
    expect((await chatqnaContext()).kbFileIds).toEqual([NO_KNOWLEDGE_SET_FILE_ID]);
  });

  it('twin without a Knowledge Set and EMPTY_KNOWLEDGE_SET_SCOPE=all: unscoped', async () => {
    process.env.EMPTY_KNOWLEDGE_SET_SCOPE = 'all';
    mockGetTwinByKey.mockResolvedValue({ _key: 'twin-1', linkedKbFileIds: [] });
    expect(await chatqnaContext()).not.toHaveProperty('kbFileIds');
  });

  it('failed twin lookup: unscoped', async () => {
    mockGetTwinByKey.mockRejectedValue(new Error('AI twin not found'));
    expect(await chatqnaContext()).not.toHaveProperty('kbFileIds');
  });

  it('session without a twin: unscoped, and no lookup', async () => {
    chatSessionService.getSessionForUser.mockResolvedValueOnce({ _key: 's1', userId: 'u1', twinId: null });
    expect(await chatqnaContext()).not.toHaveProperty('kbFileIds');
    expect(mockGetTwinByKey).not.toHaveBeenCalled();
  });
});
