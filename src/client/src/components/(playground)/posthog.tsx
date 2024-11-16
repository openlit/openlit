import { PostHogConfig } from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { ReactNode } from "react";

const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
	api_host: process.env.POSTHOG_API_HOST,
	// debug: process.env.NODE_ENV !== "production",
	autocapture: false,
};

export default function CustomPostHogProvider({
	children,
}: {
	children: ReactNode;
}) {
	if (process.env.TELEMETRY_ENABLED) {
		return (
			<PostHogProvider
				apiKey={process.env.POSTHOG_API_KEY}
				options={POSTHOG_OPTIONS}
			>
				{children}
			</PostHogProvider>
		);
	}

	return children;
}
