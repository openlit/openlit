jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/chat/table-details', () => ({
  OPENLIT_CHAT_CONVERSATION_TABLE: 'openlit_chat_conversation',
  OPENLIT_CHAT_MESSAGE_TABLE: 'openlit_chat_message',
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: {
    sanitizeValue: jest.fn((v: string) => v),
  },
}));

import {
  getConversations,
  getConversationWithMessages,
  createConversation,
  deleteConversation,
  addMessage,
  updateMessage,
  updateConversation,
  getConversationMessages,
} from '@/lib/platform/chat/conversation';
import { dataCollector } from '@/lib/platform/common';

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
});

describe('getConversations', () => {
  it('returns conversations ordered by updated_at', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [
        { id: 'c1', title: 'Test', totalCost: 0.01, updatedAt: '2025-01-01' },
      ],
    });
    const { data } = await getConversations();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe('c1');
  });

  it('queries with LIMIT 50', async () => {
    await getConversations();
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('LIMIT 50');
  });

  it('passes databaseConfigId', async () => {
    await getConversations('db-1');
    expect(dataCollector).toHaveBeenCalledWith(expect.any(Object), 'query', 'db-1');
  });

  it('returns errors from dataCollector', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'query failed' });
    await expect(getConversations()).resolves.toEqual({ err: 'query failed' });
  });
});

describe('getConversationWithMessages', () => {
  it('returns a conversation with ordered messages', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'c1', title: 'Chat' }] })
      .mockResolvedValueOnce({ data: [{ id: 'm1', role: 'user', content: 'Hi' }] });

    const { data } = await getConversationWithMessages('c1', 'db-1');

    expect(data).toEqual({
      conversation: { id: 'c1', title: 'Chat' },
      messages: [{ id: 'm1', role: 'user', content: 'Hi' }],
    });
    expect(dataCollector).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ query: expect.stringContaining("WHERE id = 'c1'") }),
      'query',
      'db-1'
    );
    expect(dataCollector).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ query: expect.stringContaining("WHERE conversation_id = 'c1'") }),
      'query',
      'db-1'
    );
  });

  it('returns conversation query errors', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'conversation failed' });
    await expect(getConversationWithMessages('c1')).resolves.toEqual({
      err: 'conversation failed',
    });
  });

  it('returns not found when no conversation exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [] });
    await expect(getConversationWithMessages('missing')).resolves.toEqual({
      err: 'Conversation not found',
    });
  });

  it('returns message query errors', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'c1' }] })
      .mockResolvedValueOnce({ err: 'messages failed' });

    await expect(getConversationWithMessages('c1')).resolves.toEqual({
      err: 'messages failed',
    });
  });
});

describe('createConversation', () => {
  it('inserts into conversation table', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null, data: {} }) // insert
      .mockResolvedValueOnce({ data: [{ id: 'new-id' }] }); // select latest
    const { data } = await createConversation('Test', 'openai', 'gpt-4');
    expect(data).toBe('new-id');
  });

  it('returns error on insert failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'fail' });
    const { err } = await createConversation('Test', 'openai', 'gpt-4');
    expect(err).toBe('fail');
  });

  it('returns latest select errors after insert succeeds', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null, data: {} })
      .mockResolvedValueOnce({ err: 'latest failed' });

    await expect(createConversation('Test', 'openai', 'gpt-4')).resolves.toEqual({
      err: 'latest failed',
    });
  });
});

describe('deleteConversation', () => {
  it('deletes messages first, then conversation', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deleteConversation('c1');
    expect(dataCollector).toHaveBeenCalledTimes(2);
    const firstCall = (dataCollector as jest.Mock).mock.calls[0][0].query;
    expect(firstCall).toContain('openlit_chat_message');
    const secondCall = (dataCollector as jest.Mock).mock.calls[1][0].query;
    expect(secondCall).toContain('openlit_chat_conversation');
  });

  it('stops when deleting messages fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValueOnce({ err: 'message delete failed' });

    await expect(deleteConversation('c1')).resolves.toEqual({
      err: 'message delete failed',
    });
    expect(dataCollector).toHaveBeenCalledTimes(1);
  });

  it('returns conversation delete errors', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null })
      .mockResolvedValueOnce({ err: 'conversation delete failed' });

    await expect(deleteConversation('c1')).resolves.toEqual({
      err: 'conversation delete failed',
    });
  });
});

describe('addMessage', () => {
  it('inserts message with all fields', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null, data: {} }) // insert
      .mockResolvedValueOnce({ data: [{ id: 'msg-1' }] }); // select latest
    const { data } = await addMessage({
      conversationId: 'c1',
      role: 'user',
      content: 'Hello',
      promptTokens: 10,
      completionTokens: 20,
      cost: 0.001,
    });
    expect(data).toBe('msg-1');
    const insertCall = (dataCollector as jest.Mock).mock.calls[0];
    expect(insertCall[0].table).toBe('openlit_chat_message');
    expect(insertCall[0].values[0].role).toBe('user');
    expect(insertCall[0].values[0].prompt_tokens).toBe(10);
  });

  it('defaults optional message fields', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null, data: {} })
      .mockResolvedValueOnce({ data: [] });

    const { data } = await addMessage({
      conversationId: 'c1',
      role: 'assistant',
      content: 'Hello',
    });

    expect(data).toBeUndefined();
    expect(dataCollector).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        values: [
          expect.objectContaining({
            sql_query: '',
            query_result: '',
            widget_type: '',
            prompt_tokens: 0,
            completion_tokens: 0,
            cost: 0,
          }),
        ],
      }),
      'insert',
      undefined
    );
  });

  it('returns insert errors', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'insert failed' });
    await expect(addMessage({
      conversationId: 'c1',
      role: 'user',
      content: 'Hello',
    })).resolves.toEqual({ err: 'insert failed' });
  });
});

describe('updateMessage', () => {
  it('updates message with query result', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await updateMessage('msg-1', { queryResult: '[]', queryRowsRead: 5 });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('ALTER TABLE');
    expect(query).toContain('query_result');
    expect(query).toContain('query_rows_read = 5');
  });

  it('updates execution time and bytes read', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await updateMessage('msg-1', {
      queryExecutionTimeMs: 12,
      queryBytesRead: 4096,
    });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('query_execution_time_ms = 12');
    expect(query).toContain('query_bytes_read = 4096');
  });

  it('skips update when no fields provided', async () => {
    await updateMessage('msg-1', {});
    expect(dataCollector).not.toHaveBeenCalled();
  });
});

describe('updateConversation', () => {
  it('updates title', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await updateConversation('c1', { title: 'New Title' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("title = 'New Title'");
    expect(query).toContain('updated_at = now()');
  });

  it('accumulates token counts', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await updateConversation('c1', { addPromptTokens: 100, addCompletionTokens: 50, addCost: 0.01 });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('total_prompt_tokens = total_prompt_tokens + 100');
    expect(query).toContain('total_completion_tokens = total_completion_tokens + 50');
    expect(query).toContain('total_cost = total_cost + 0.01');
  });

  it('increments message count', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await updateConversation('c1', { incrementMessages: true });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('total_messages = total_messages + 1');
  });
});

describe('getConversationMessages', () => {
  it('returns messages for a conversation', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ id: 'm1', role: 'user', content: 'Hello' }],
    });
    const { data } = await getConversationMessages('c1');
    expect(data).toHaveLength(1);
  });

  it('respects limit parameter', async () => {
    await getConversationMessages('c1', 5);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('LIMIT 5');
  });

  it('returns errors from dataCollector', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'messages failed' });
    await expect(getConversationMessages('c1')).resolves.toEqual({
      err: 'messages failed',
    });
  });
});
