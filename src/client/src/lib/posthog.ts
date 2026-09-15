import {
	POSTHOG_API_HOST,
	POSTHOG_API_KEY,
} from "@/constants/posthog";
import { shouldCaptureServerTelemetryEvent } from "@/lib/posthog-sampling";
import { jsonStringify } from "@/utils/json";
import { consoleLog } from "@/utils/log";
import { randomUUID } from "crypto";
/* This is to force the node to use IPv4 for posthog events. Although this sets this config globally but right now it's only used for posthog events. If any problem occurs in future, we can remove this or use a undici for the fetch wrapper */
import { setDefaultAutoSelectFamily } from 'node:net';
setDefaultAutoSelectFamily(false);

export default class PostHogServer {
	static distinctId: string = randomUUID();

	static async capture(options: {
		event: string,
		timestamp?: Date,
		distinctId?: string,
		properties?: Record<string, unknown>,
	}) {
		const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

		try {
			if (telemetryEnabled) {
				await fetch(
					`${POSTHOG_API_HOST}/capture/`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: jsonStringify({
							api_key: POSTHOG_API_KEY,
							event: options.event,
							timestamp: options.timestamp,
							// Prefer an explicit distinctId (e.g. stable install_id
							// for daily snapshots) so server restarts don't look
							// like new "persons" for install-scoped events.
							distinct_id: options.distinctId || this.distinctId,
							properties: {
								...(options.properties || {}),
								isServer: true,
							},
						}),
					},
				);
			}
		} catch (error) {
			consoleLog("Error capturing telemetry events:", error);
		}
	}

	static async fireEvent({
		event,
		properties = {},
		startTimestamp,
		sampleKey,
	}: {
		event: string;
		properties?: Record<string, unknown>;
		startTimestamp: number;
		/** Dedupes / samples high-volume success events (e.g. per widget id). */
		sampleKey?: string;
	}) {
		if (!shouldCaptureServerTelemetryEvent(event, sampleKey)) {
			return;
		}
		await PostHogServer.capture({
			event,
			timestamp: new Date(startTimestamp),
			properties: {
				...properties,
				responseTime: Date.now() - startTimestamp,
			},
		});
	}
}
