describe("custom dashboard migration", () => {
  it("does not seed dashboards when table creation fails", async () => {
    jest.resetModules();
    const mockHelper = jest.fn().mockResolvedValue({
      migrationExist: false,
      queriesRun: false,
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

    const { default: migration } =
      await import("@/clickhouse/migrations/create-custom-dashboards-migration");

    await expect(migration("db-1")).resolves.toEqual({
      migrationExist: false,
      queriesRun: false,
    });
    expect(mockSeed).not.toHaveBeenCalled();
  });
});
