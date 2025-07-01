import {
	NEXT_PUBLIC_POSTHOG_API_HOST,
	NEXT_PUBLIC_POSTHOG_API_KEY,
} from "@/constants/posthog";
import { consoleLog } from "@/utils/log";
import { randomUUID } from "crypto";
import { PostHog } from "posthog-node";

export default class PostHogServer {
	static client: PostHog;
	static distinctId: string;
	static createClient() {
		this.client = new PostHog(NEXT_PUBLIC_POSTHOG_API_KEY, {
			host: NEXT_PUBLIC_POSTHOG_API_HOST,
			flushAt: 1,
			flushInterval: 0,
		});
		this.distinctId = randomUUID();
	}

	static capture(options: Parameters<PostHog["capture"]>[0]) {
		const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

		try {
			if (telemetryEnabled) {
				if (!this.client) {
					this.createClient();
				}

				this.client.capture({
					...options,
					properties: {
						...(options.properties || {}),
						isServer: true,
					},
				});
				this.client.shutdown();
			}
		} catch (error) {
			consoleLog("Error capturing telemetry events:", error);
		}
	}

	static fireEvent({
		event,
		properties = {},
		startTimestamp,
	}: {
		event: string;
		properties?: Record<string, any>;
		startTimestamp: number;
	}) {
		PostHogServer.capture({
			event,
			distinctId: this.distinctId,
			properties: {
				...properties,
				responseTime: Date.now() - startTimestamp,
			},
		});
	}
}
