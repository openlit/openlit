import assert from "node:assert/strict"
import test from "node:test"

globalThis.__OPENLIT_BIN_JSON__ = "openlit"
if (typeof globalThis.Bun === "undefined") globalThis.Bun = {}
globalThis.Bun.spawn = () => ({ exited: Promise.resolve(0) })

const { OpenLitPlugin } = await import(
  new URL("../../../../../plugins/opencode/openlit.ts", import.meta.url),
)

function deferred() {
  let resolve
  const promise = new Promise((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

async function hooks() {
  return OpenLitPlugin({ directory: "/workspace", worktree: "/workspace" })
}

async function payloads(calls) {
  return Promise.all(calls.map(async (call) => JSON.parse(await call.stdin.text())))
}

test("defers subprocess work and sends one event at a time", async () => {
  const firstExit = deferred()
  const allStarted = deferred()
  const fourthStarted = deferred()
  const calls = []
  let active = 0
  let maxActive = 0

  globalThis.Bun.spawn = (_command, options) => {
    active++
    maxActive = Math.max(maxActive, active)
    calls.push(options)
    if (calls.length === 3) allStarted.resolve()
    if (calls.length === 4) fourthStarted.resolve()
    const exited = calls.length === 1 ? firstExit.promise : Promise.resolve(0)
    return {
      exited: exited.finally(() => {
        active--
      }),
    }
  }

  const plugin = await hooks()
  void plugin.event({
    event: {
      type: "session.created",
      properties: { info: { id: "session-1", time: { created: 1 } } },
    },
  })
  void plugin.event({
    event: { type: "session.idle", properties: { sessionID: "session-1" } },
  })
  void plugin.event({
    event: {
      type: "session.deleted",
      properties: { info: { id: "session-1", time: { created: 1 } } },
    },
  })

  assert.equal(calls.length, 0, "the hook must not spawn synchronously")
  await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.equal(maxActive, 1)

  firstExit.resolve(0)
  await allStarted.promise
  assert.equal(calls.length, 3)
  assert.equal(maxActive, 1)

  await new Promise((resolve) => setImmediate(resolve))
  void plugin.event({
    event: { type: "session.idle", properties: { sessionID: "after-drain" } },
  })
  assert.equal(calls.length, 3, "a later drain must also remain deferred")
  await fourthStarted.promise
  assert.equal(calls.length, 4)
  assert.equal(maxActive, 1)
})

test("bounds a flooded queue and preserves later high-priority events", async () => {
  const firstExit = deferred()
  const allStarted = deferred()
  const calls = []

  globalThis.Bun.spawn = (_command, options) => {
    calls.push(options)
    if (calls.length === 33) allStarted.resolve()
    return { exited: calls.length === 1 ? firstExit.promise : Promise.resolve(0) }
  }

  const plugin = await hooks()
  void plugin.event({
    event: {
      type: "session.created",
      properties: { info: { id: "session-2", time: { created: 1 } } },
    },
  })
  await Promise.resolve()
  assert.equal(calls.length, 1)

  const hookPromises = []
  for (let index = 0; index < 70; index++) {
    hookPromises.push(
      plugin["tool.execute.before"](
        { tool: "bash", sessionID: "session-2", callID: `call-${index}` },
        { args: { command: `echo ${index}` } },
      ),
    )
  }
  hookPromises.push(
    plugin["tool.execute.after"](
      {
        tool: "bash",
        sessionID: "session-2",
        callID: "call-69",
        args: { command: "echo 69" },
      },
      { title: "done", output: "69", metadata: {} },
    ),
  )
  hookPromises.push(
    plugin.event({
      event: {
        type: "session.error",
        properties: { sessionID: "session-2", error: { name: "ExporterUnavailable" } },
      },
    }),
  )

  await Promise.all(hookPromises)
  assert.equal(calls.length, 1, "hooks must not wait for the blocked exporter")

  firstExit.resolve(0)
  await allStarted.promise
  await new Promise((resolve) => setImmediate(resolve))
  const bodies = await payloads(calls)
  assert.equal(bodies.length, 33, "one in-flight event plus 32 queued events")
  assert.deepEqual(
    bodies.slice(1, 31).map((body) => body.event.properties.callID),
    Array.from({ length: 30 }, (_, index) => `call-${index + 2}`),
  )
  assert.deepEqual(
    bodies.slice(-2).map((body) => body.event.type),
    ["tool.execute.after", "session.error"],
  )

  void plugin.event({
    event: { type: "session.idle", properties: { sessionID: "after-flood" } },
  })
  assert.equal(calls.length, 33, "a post-flood drain must remain deferred")
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 34)
})

test("rejects a new high-priority event when the queue contains only peers", async () => {
  const firstExit = deferred()
  const allStarted = deferred()
  const calls = []

  globalThis.Bun.spawn = (_command, options) => {
    calls.push(options)
    if (calls.length === 33) allStarted.resolve()
    return { exited: calls.length === 1 ? firstExit.promise : Promise.resolve(0) }
  }

  const plugin = await hooks()
  void plugin.event({
    event: {
      type: "session.created",
      properties: { info: { id: "in-flight", time: { created: 1 } } },
    },
  })
  await Promise.resolve()

  for (let index = 0; index < 32; index++) {
    void plugin.event({
      event: {
        type: "session.created",
        properties: { info: { id: `queued-${index}`, time: { created: 1 } } },
      },
    })
  }
  void plugin.event({
    event: {
      type: "session.error",
      properties: { sessionID: "rejected", error: { name: "QueueFull" } },
    },
  })

  firstExit.resolve(0)
  await allStarted.promise
  await new Promise((resolve) => setImmediate(resolve))
  const bodies = await payloads(calls)
  assert.equal(bodies.length, 33)
  assert.equal(bodies.some((body) => body.event.type === "session.error"), false)
})

test("continues draining after a telemetry subprocess fails", async () => {
  const secondStarted = deferred()
  const calls = []

  globalThis.Bun.spawn = (_command, options) => {
    calls.push(options)
    if (calls.length === 2) secondStarted.resolve()
    return {
      exited:
        calls.length === 1
          ? Promise.reject(new Error("exporter unavailable"))
          : Promise.resolve(0),
    }
  }

  const plugin = await hooks()
  void plugin.event({
    event: {
      type: "session.created",
      properties: { info: { id: "failed", time: { created: 1 } } },
    },
  })
  void plugin.event({
    event: { type: "session.idle", properties: { sessionID: "still-sent" } },
  })

  await secondStarted.promise
  assert.equal(calls.length, 2)
})
