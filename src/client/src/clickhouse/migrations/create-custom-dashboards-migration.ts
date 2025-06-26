import migrationHelper from "./migration-helper";
import CreateCustomDashboardsSeed from "../seed/dashboards";

const MIGRATION_ID = "create-custom-dashboards-table";

// Table names can be moved to a constants file if needed
const CUSTOM_DASHBOARDS_BOARDS_TABLE = "openlit_board";
const CUSTOM_DASHBOARDS_FOLDERS_TABLE = "openlit_folder";
const CUSTOM_DASHBOARDS_WIDGETS_TABLE = "openlit_widget";
const CUSTOM_DASHBOARDS_BOARD_WIDGETS_TABLE = "openlit_board_widget";

export default async function CreateCustomDashboardsMigration(databaseConfigId?: string) {
  const queries = [
    `
    CREATE TABLE IF NOT EXISTS ${CUSTOM_DASHBOARDS_FOLDERS_TABLE} (
      id UUID DEFAULT generateUUIDv4(),      -- Unique ID for each folder
      title String,                          -- Folder title
      description String,                     -- Folder description
      parent_id Nullable(UUID),              -- Parent folder ID, null for root folders
      created_at DateTime DEFAULT now(),      -- Creation timestamp
      updated_at DateTime DEFAULT now(),      -- Last update timestamp
      tags String DEFAULT '[]',               -- Tags for the folder
      PRIMARY KEY id
    ) ENGINE = MergeTree()
    ORDER BY id;
    `,
    `
    CREATE TABLE IF NOT EXISTS ${CUSTOM_DASHBOARDS_BOARDS_TABLE} (
      id UUID DEFAULT generateUUIDv4(),      -- Unique ID for each board
      title String,                          -- Board title
      description String,                     -- Board description
      parent_id Nullable(UUID),              -- Parent folder ID
      is_main_dashboard Boolean,             -- Flag for main dashboard
      created_at DateTime DEFAULT now(),      -- Creation timestamp
      updated_at DateTime DEFAULT now(),      -- Last update timestamp
      is_pinned Boolean DEFAULT false,         -- Flag for pinned boards
      tags String DEFAULT '[]',               -- Tags for the board
      PRIMARY KEY id
    ) ENGINE = MergeTree()
    ORDER BY id;
    `,
    `
    CREATE TABLE IF NOT EXISTS ${CUSTOM_DASHBOARDS_WIDGETS_TABLE} (
      id UUID DEFAULT generateUUIDv4(),      -- Unique ID for each widget
      title String,                          -- Widget title
      description String,                     -- Widget description
      widget_type String,                    -- Type of widget
      properties String,                      -- JSON string of widget properties
      config String,                          -- JSON string of config (query string, respect the filters flag etc)
      created_at DateTime DEFAULT now(),      -- Creation timestamp
      updated_at DateTime DEFAULT now(),      -- Last update timestamp
      PRIMARY KEY id
    ) ENGINE = MergeTree()
    ORDER BY id;
    `,
    `
    CREATE TABLE IF NOT EXISTS ${CUSTOM_DASHBOARDS_BOARD_WIDGETS_TABLE} (
      id UUID DEFAULT generateUUIDv4(),      -- Unique ID for board widget mapping
      board_id UUID,                         -- Reference to board
      widget_id UUID,                        -- Reference to widget
      position String DEFAULT '{}',          -- JSON string of position (x, y, w, h)
      created_at DateTime DEFAULT now(),      -- Creation timestamp
      updated_at DateTime DEFAULT now(),      -- Last update timestamp
      INDEX board_widget_index (board_id, widget_id) TYPE minmax GRANULARITY 1,
      PRIMARY KEY id
    ) ENGINE = MergeTree()
    ORDER BY id;
    `
  ];

  const { migrationExist, queriesRun } = await migrationHelper({
    clickhouseMigrationId: MIGRATION_ID,
    databaseConfigId,
    queries,
  });

  if (!migrationExist) {
    await CreateCustomDashboardsSeed();
  }

  return { migrationExist, queriesRun };
}
