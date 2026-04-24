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
});
