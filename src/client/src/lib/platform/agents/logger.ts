/**
 * Tiny structured logger scoped to the agents server modules.
 *
 * Background: the agents read/write path runs inside Next.js Route Handlers
 * and a host crontab tick. Both surfaces emit logs to stdout/stderr where
 * production aggregators (Loki, CloudWatch, etc.) ingest them. Plain
 * `console.error("[agents] foo", err)` produces a single unstructured line
 * that is awkward to filter, and it makes the operator hand-parse the error
 * shape every time.
 *
 * This logger keeps the public surface minimal:
 *   - `agentsLogger.error(event, fields?)` — fatal/recoverable failure
 *   - `agentsLogger.warn(event, fields?)`  — degraded behavior, not a failure
 *   - `agentsLogger.info(event, fields?)`  — operational telemetry
 *   - `agentsLogger.debug(event, fields?)` — guarded by `AGENTS_LOG_DEBUG`
 *
 * Every line is a single JSON object with `level`, `ts`, `scope=agents`,
 * `event`, plus any extra fields the caller passes. Error values are
 * normalised to `{ message, name, stack? }` so they survive `JSON.stringify`
 * (raw `Error` instances drop their properties when stringified).
 *
 * Stays deliberately stdlib-only: no pino/winston in this repo today, and
 * pulling one in for the agents path alone is overkill. If the project
 * later adopts a global logger, the call sites here use a stable interface
 * (`scope`, `event`, `level`) that maps cleanly onto any structured backend.
 */

type LogLevel = "error" | "warn" | "info" | "debug";

interface LogFields {
	[key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

function envLogLevel(): LogLevel {
	const raw = (process.env.AGENTS_LOG_LEVEL || "info").toLowerCase();
	if (raw in LEVEL_PRIORITY) return raw as LogLevel;
	return "info";
}

function normalizeError(value: unknown): unknown {
	if (value instanceof Error) {
		const out: Record<string, unknown> = {
			message: value.message,
			name: value.name,
		};
		if (process.env.AGENTS_LOG_STACK !== "false" && value.stack) {
			out.stack = value.stack;
		}
		return out;
	}
	return value;
}

function normalizeFields(fields: LogFields | undefined): LogFields | undefined {
	if (!fields) return undefined;
	const out: LogFields = {};
	for (const [k, v] of Object.entries(fields)) {
		if (k === "err" || k === "error" || v instanceof Error) {
			out[k] = normalizeError(v);
		} else {
			out[k] = v;
		}
	}
	return out;
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
	if (LEVEL_PRIORITY[level] > LEVEL_PRIORITY[envLogLevel()]) return;
	const line = {
		level,
		ts: new Date().toISOString(),
		scope: "agents",
		event,
		...(normalizeFields(fields) || {}),
	};
	try {
		const serialized = JSON.stringify(line);
		if (level === "error") {
			console.error(serialized);
		} else if (level === "warn") {
			console.warn(serialized);
		} else {
			console.log(serialized);
		}
	} catch {
		// Defensive: if a caller passes a circular structure in `fields`,
		// fall back to the unstructured form so we never lose the event.
		const safe = `[agents:${level}] ${event}`;
		if (level === "error") console.error(safe);
		else if (level === "warn") console.warn(safe);
		else console.log(safe);
	}
}

export const agentsLogger = {
	error: (event: string, fields?: LogFields) => emit("error", event, fields),
	warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
	info: (event: string, fields?: LogFields) => emit("info", event, fields),
	debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
};
