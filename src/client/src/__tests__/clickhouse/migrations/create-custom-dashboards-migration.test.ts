describe("custom dashboard migration", () => {
  it("does not seed dashboards when table creation fails", async () => {
    jest.resetModules();
    const mockHelper = jest.fn().mockResolvedValue({
      migrationExist: false,
      queriesRun: false,
    });
    const mockTableCollector = jest.fn().mockResolvedValue({
      data: [
        { name: "openlit_folder" },
        { name: "openlit_board" },
        { name: "openlit_widget" },
        { name: "openlit_board_widget" },
      ],
    });
    const mockSeed = jest.fn();
    jest.doMock("@/clickhouse/migrations/migration-helper", () => ({
      __esModule: true,
      default: mockHelper,
    }));
    jest.doMock("@/clickhouse/seed/dashboards", () => ({
      __esModule: true,
      default: mockSeed,
    }));
    jest.doMock("@/lib/platform/common", () => ({
      __esModule: true,
      intelligenceDataCollector: mockTableCollector,
    }));

    const { default: migration } =
      await import("@/clickhouse/migrations/create-custom-dashboards-migration");

    await expect(migration("db-1")).resolves.toEqual({
      migrationExist: false,
      queriesRun: false,
    });
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it("reports missing dashboard tables and does not seed", async () => {
    jest.resetModules();
    const mockHelper = jest.fn().mockResolvedValue({
      migrationExist: false,
      queriesRun: true,
    });
    const mockTableCollector = jest.fn().mockResolvedValue({
      data: [{ name: "openlit_folder" }, { name: "openlit_board" }],
    });
    const mockSeed = jest.fn();
    jest.doMock("@/clickhouse/migrations/migration-helper", () => ({
      __esModule: true,
      default: mockHelper,
    }));
    jest.doMock("@/clickhouse/seed/dashboards", () => ({
      __esModule: true,
      default: mockSeed,
    }));
    jest.doMock("@/lib/platform/common", () => ({
      __esModule: true,
      intelligenceDataCollector: mockTableCollector,
    }));

    const { default: migration } =
      await import("@/clickhouse/migrations/create-custom-dashboards-migration");

    await expect(migration("db-1")).resolves.toMatchObject({
      migrationExist: false,
      queriesRun: true,
      err: expect.stringContaining(
        "missing tables: openlit_widget, openlit_board_widget"
      ),
    });
    expect(mockSeed).not.toHaveBeenCalled();
  });
});
