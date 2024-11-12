import { consoleLog } from "@/utils/log";
import { PostHog } from "posthog-node";

type EventMessage = Parameters<PostHog["capture"]>[0];

export default class PostHogServer {
	static client: PostHog;
	static createClient() {
		this.client = new PostHog(process.env.POSTHOG_API_KEY!, {
			host: process.env.POSTHOG_API_HOST,
			flushAt: 1,
			flushInterval: 0,
		});
	}

	static capture(options: EventMessage) {
		try {
			if (process.env.TELEMETRY_ENABLED) {
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
}
