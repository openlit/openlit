import {
  OPENLIT_PROMPTS_TABLE_NAME,
  OPENLIT_PROMPT_VERSIONS_TABLE_NAME,
  OPENLIT_PROMPT_VERSION_DOWNLOADS_TABLE_NAME,
} from '@/lib/platform/prompt/table-details';

describe('prompt table-details', () => {
  it('exports the correct prompts table name', () => {
    expect(OPENLIT_PROMPTS_TABLE_NAME).toBe('openlit_prompts');
  });

  it('exports the correct prompt versions table name', () => {
    expect(OPENLIT_PROMPT_VERSIONS_TABLE_NAME).toBe('openlit_prompt_versions');
  });

  it('exports the correct prompt version downloads table name', () => {
    expect(OPENLIT_PROMPT_VERSION_DOWNLOADS_TABLE_NAME).toBe('openlit_prompt_version_downloads');
  });
});
