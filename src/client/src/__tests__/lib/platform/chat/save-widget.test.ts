jest.mock('@/lib/platform/manage-dashboard/widget', () => ({
  createWidget: jest.fn(),
}));
jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/manage-dashboard/table-details', () => ({
  OPENLIT_BOARD_WIDGET_TABLE_NAME: 'openlit_board_widget',
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));

import { saveQueryAsWidget, convertToMustacheTemplate } from '@/lib/platform/chat/save-widget';
import { createWidget } from '@/lib/platform/manage-dashboard/widget';
import { dataCollector } from '@/lib/platform/common';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('convertToMustacheTemplate', () => {
  it('replaces parseDateTimeBestEffort start_time', () => {
    const query = "parseDateTimeBestEffort('2025-01-01') AS start_time";
    const result = convertToMustacheTemplate(query);
    expect(result).toContain("{{filter.timeLimit.start}}");
    expect(result).toContain("AS start_time");
  });

  it('replaces parseDateTimeBestEffort end_time', () => {
    const query = "parseDateTimeBestEffort('2025-12-31') AS end_time";
    const result = convertToMustacheTemplate(query);
    expect(result).toContain("{{filter.timeLimit.end}}");
  });

  it('replaces now() - INTERVAL pattern', () => {
    const query = "WHERE Timestamp >= now() - INTERVAL 24 HOUR";
    const result = convertToMustacheTemplate(query);
    expect(result).toContain("{{filter.timeLimit.start}}");
  });

  it('replaces toStartOfDay(now())', () => {
    const query = "WHERE Timestamp >= toStartOfDay(now())";
    const result = convertToMustacheTemplate(query);
    expect(result).toContain("{{filter.timeLimit.start}}");
  });

  it('replaces hardcoded date strings', () => {
    const query = "WHERE Timestamp >= '2025-01-01 00:00:00' AND Timestamp <= '2025-12-31 23:59:59'";
    const result = convertToMustacheTemplate(query);
    expect(result).toContain("{{filter.timeLimit.start}}");
    expect(result).toContain("{{filter.timeLimit.end}}");
  });

  it('preserves query without time references', () => {
    const query = "SELECT COUNT(*) FROM otel_traces LIMIT 10";
    expect(convertToMustacheTemplate(query)).toBe(query);
  });
});

describe('saveQueryAsWidget', () => {
  it('creates a widget successfully', async () => {
    (createWidget as jest.Mock).mockResolvedValue({ data: { id: 'w1', title: 'Test' } });

    const result = await saveQueryAsWidget({
      title: 'Test Widget',
      type: 'BAR_CHART',
      query: 'SELECT * FROM otel_traces LIMIT 10',
    });

    expect(result.data).toBeDefined();
    expect(createWidget).toHaveBeenCalledTimes(1);
    const widgetArg = (createWidget as jest.Mock).mock.calls[0][0];
    expect(widgetArg.title).toBe('Test Widget');
    expect(widgetArg.type).toBe('BAR_CHART');
  });

  it('returns error when createWidget fails', async () => {
    (createWidget as jest.Mock).mockResolvedValue({ err: 'creation failed' });

    const result = await saveQueryAsWidget({
      title: 'Test',
      type: 'TABLE',
      query: 'SELECT 1',
    });

    expect(result.err).toBe('creation failed');
  });

  it('links widget to board when boardId provided', async () => {
    (createWidget as jest.Mock).mockResolvedValue({ data: { id: 'w1' } });
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    await saveQueryAsWidget({
      title: 'Test',
      type: 'TABLE',
      query: 'SELECT 1',
      boardId: 'board-123',
    });

    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'openlit_board_widget' }),
      'insert'
    );
    const insertValues = (dataCollector as jest.Mock).mock.calls[0][0].values[0];
    expect(insertValues.board_id).toBe('board-123');
  });

  it('returns warning when board linking fails', async () => {
    (createWidget as jest.Mock).mockResolvedValue({ data: { id: 'w1' } });
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'link failed' });

    const result = await saveQueryAsWidget({
      title: 'Test',
      type: 'TABLE',
      query: 'SELECT 1',
      boardId: 'board-123',
    });

    expect(result.data).toBeDefined();
    expect(result.warning).toContain('could not be added');
  });

  it('does not link to board when boardId is absent', async () => {
    (createWidget as jest.Mock).mockResolvedValue({ data: { id: 'w1' } });

    await saveQueryAsWidget({
      title: 'Test',
      type: 'TABLE',
      query: 'SELECT 1',
    });

    expect(dataCollector).not.toHaveBeenCalled();
  });
});
