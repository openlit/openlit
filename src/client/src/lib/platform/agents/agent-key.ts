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
 * Collapse placeholder / local-dev environment labels to `default` so SDK
 * sample apps don't create a noisy `local` dimension on agent identity.
 */
export function normalizeDeploymentEnvironment(
	environment?: string | null
): string {
	const env = (environment || "").trim();
	if (
		!env ||
		env.toLowerCase() === "local" ||
		env === "default_environment"
	) {
		return "default";
	}
	return env;
}

/**
 * ClickHouse predicate that treats empty / local-dev labels as `default`.
 */
export function deploymentEnvironmentSqlPredicate(
	environment: string | null | undefined,
	escape: (value: string) => string
): string {
	const env = normalizeDeploymentEnvironment(environment);
	if (env === "default") {
		return `(ResourceAttributes['deployment.environment'] IN ('default', 'local', 'default_environment', ''))`;
	}
	return `ResourceAttributes['deployment.environment'] = '${escape(env)}'`;
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
	const env = normalizeDeploymentEnvironment(environment);
	return createHash("sha1")
		.update(`${cluster}|${env}|${serviceName}`)
		.digest("hex")
		.slice(0, 16);
}
