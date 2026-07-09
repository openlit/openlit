/**
 * Leaf helpers for agent identity + cache invalidation.
 *
 * Extracted from `./index` so that `snapshot` and `materialize` can compute
 * agent keys / drop cached rows WITHOUT importing `./index`. `index` imports
 * `materialize`, and both `materialize` and `snapshot` previously imported
 * `computeAgentKey`/`invalidateAgent` back from `index`, forming an
 * index <-> materialize <-> snapshot import cycle. That latent cycle produced a
 * "Cannot access 'X' before initialization" TDZ once webpack chunked these
 * modules together in a production build. This module depends only on `crypto`
 * and the leaf `./cache`, so it breaks the cycle.
 */

import { createHash } from "crypto";
import { invalidate } from "./cache";

/** Drop the cached detail row for an agent so the next read is fresh. */
export function invalidateAgent(agentKey: string, dbConfigId?: string) {
	invalidate(`agents:detail:${dbConfigId || "default"}:${agentKey}`);
}

/**
 * Compute the deterministic agent_key used as the URL slug + primary key.
 * Matches the formula used by the materializer.
 */
export function computeAgentKey(
	clusterId: string,
	environment: string,
	serviceName: string
): string {
	const cluster = clusterId || "default";
	const env = environment || "default";
	return createHash("sha1")
		.update(`${cluster}|${env}|${serviceName}`)
		.digest("hex")
		.slice(0, 16);
}
