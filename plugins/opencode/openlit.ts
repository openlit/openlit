import type { Plugin } from "@opencode-ai/plugin"

const openlitBin = __OPENLIT_BIN_JSON__
// One additional event may be in-flight while this queue is full.
const maxQueuedEmissions = 32

type OpenCodeEvent = {
  type: string
  properties?: unknown
}

type JSONRecord = Record<string, unknown>

type PendingEmission = {
  event: OpenCodeEvent
  priority: number
}

function asRecord(value: unknown): JSONRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as JSONRecord
}

function projectSessionInfo(value: unknown): JSONRecord | undefined {
  const info = asRecord(value)
  if (!info) return
  const time = asRecord(info.time)
  return {
    id: info.id,
    directory: info.directory,
    parentID: info.parentID,
    version: info.version,
    time: { created: time?.created },
  }
}

function projectMessageInfo(value: unknown): JSONRecord | undefined {
  const info = asRecord(value)
  if (!info || info.role !== "assistant") return
  const time = asRecord(info.time)
  if (typeof time?.completed !== "number" || time.completed <= 0) return
  const model = asRecord(info.model)
  const tokens = asRecord(info.tokens)
  const cache = asRecord(tokens?.cache)
  return {
    id: info.id,
    sessionID: info.sessionID,
    role: info.role,
    mode: info.mode,
    modelID: info.modelID,
    providerID: info.providerID,
    model: {
      modelID: model?.modelID,
      providerID: model?.providerID,
    },
    time: {
      created: time.created,
      completed: time.completed,
    },
    cost: info.cost,
    finish: info.finish,
    tokens: {
      input: tokens?.input,
      output: tokens?.output,
      reasoning: tokens?.reasoning,
      cache: {
        read: cache?.read,
        write: cache?.write,
      },
    },
  }
}

function projectEvent(event: OpenCodeEvent): OpenCodeEvent | undefined {
  const properties = asRecord(event.properties)
  switch (event.type) {
    case "session.created":
    case "session.deleted": {
      const info = projectSessionInfo(properties?.info)
      if (!info) return
      return { type: event.type, properties: { info } }
    }
    case "session.idle":
      return {
        type: event.type,
        properties: { sessionID: properties?.sessionID },
      }
    case "session.error": {
      const error = asRecord(properties?.error)
      return {
        type: event.type,
        properties: {
          sessionID: properties?.sessionID,
          errorName: error?.name,
        },
      }
    }
    case "message.updated": {
      const info = projectMessageInfo(properties?.info)
      if (!info) return
      return { type: event.type, properties: { info } }
    }
    case "message.part.updated": {
      const part = asRecord(properties?.part)
      const state = asRecord(part?.state)
      if (part?.type !== "tool") return
      const metadata = asRecord(part.metadata)
      const isError = state?.status === "error"
      const isProviderExecutedSuccess =
        state?.status === "completed" && metadata?.providerExecuted === true
      if (!isError && !isProviderExecutedSuccess) return
      const time = asRecord(state.time)
      return {
        type: isError ? "tool.execute.error" : "tool.execute.completed",
        properties: {
          sessionID: part.sessionID,
          callID: part.callID,
          tool: part.tool,
          status: state.status,
          startedAt: time?.start,
          endedAt: time?.end,
        },
      }
    }
  }
}

async function emit(event: OpenCodeEvent, directory: string, worktree: string) {
  try {
    const payload = new Blob([JSON.stringify({ event, directory, worktree })])
    const child = Bun.spawn(
      [openlitBin, "coding", "hook", "--vendor=opencode", `--event=${event.type}`],
      {
        stdin: payload,
        stdout: "ignore",
        stderr: "ignore",
        timeout: 5_000,
        windowsHide: true,
      },
    )
    await child.exited
  } catch {
    // Telemetry must never interrupt the user's OpenCode session.
  }
}

function emissionPriority(eventType: string) {
  if (eventType === "tool.execute.before") return 0
  return 1
}

function createEmitter(directory: string, worktree: string) {
  const queue: PendingEmission[] = []
  let draining = false
  let scheduled = false

  const scheduleDrain = () => {
    if (draining || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      void drain()
    })
  }

  const drain = async () => {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0) {
        const next = queue.shift()
        if (!next) continue
        try {
          await emit(next.event, directory, worktree)
        } catch {
          // One failed delivery must not poison the remaining queue.
        }
      }
    } finally {
      draining = false
      if (queue.length > 0) scheduleDrain()
    }
  }

  return (event: OpenCodeEvent) => {
    const priority = emissionPriority(event.type)
    if (queue.length >= maxQueuedEmissions) {
      // Preserve FIFO among peers; only higher-value telemetry may replace
      // the oldest lower-priority event at the hard overload boundary.
      const dropIndex = queue.findIndex((pending) => pending.priority < priority)
      if (dropIndex < 0) return false
      queue.splice(dropIndex, 1)
    }

    queue.push({ event, priority })
    scheduleDrain()
    return true
  }
}

function toolKey(sessionID: string, callID: string) {
  return `${sessionID}\u0000${callID}`
}

export const OpenLitPlugin: Plugin = async ({ directory, worktree }) => {
  const enqueue = createEmitter(directory, worktree)
  const toolStarts = new Map<string, number>()

  return {
    event: async ({ event }) => {
      const projected = projectEvent(event)
      if (!projected) return
      if (
        projected.type === "tool.execute.error" ||
        projected.type === "tool.execute.completed"
      ) {
        const properties = asRecord(projected.properties)
        if (typeof properties?.sessionID === "string" && typeof properties.callID === "string") {
          toolStarts.delete(toolKey(properties.sessionID, properties.callID))
        }
      }
      void enqueue(projected)
    },
    "tool.execute.before": async (input, output) => {
      try {
        const startedAt = Date.now()
        const projectedOutput = asRecord(output)
        toolStarts.set(toolKey(input.sessionID, input.callID), startedAt)
        void enqueue({
          type: "tool.execute.before",
          properties: {
            tool: input.tool,
            sessionID: input.sessionID,
            callID: input.callID,
            args: projectedOutput?.args,
            startedAt,
          },
        })
      } catch {
        // Telemetry must never interrupt tool execution.
      }
    },
    "tool.execute.after": async (input, output) => {
      try {
        const key = toolKey(input.sessionID, input.callID)
        const projectedOutput = asRecord(output)
        if (!projectedOutput) {
          toolStarts.delete(key)
          return
        }
        const endedAt = Date.now()
        const startedAt = toolStarts.get(key) ?? endedAt
        toolStarts.delete(key)
        void enqueue({
          type: "tool.execute.after",
          properties: {
            tool: input.tool,
            sessionID: input.sessionID,
            callID: input.callID,
            args: input.args,
            title: projectedOutput.title,
            output: projectedOutput.output,
            metadata: projectedOutput.metadata,
            startedAt,
            endedAt,
          },
        })
      } catch {
        // A malformed tool result must not interrupt the OpenCode session.
      }
    },
  }
}
