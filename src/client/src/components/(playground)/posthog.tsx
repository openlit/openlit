import { PostHogConfig } from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { ReactNode } from "react";

const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
	api_host: process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
	autocapture: false,
};

export default function CustomPostHogProvider({
	children,
}: {
	children: ReactNode;
}) {
	const posthogAPIKey = process.env.NEXT_PUBLIC_POSTHOG_API_KEY;
	if (process.env.NEXT_PUBLIC_TELEMETRY_ENABLED) {
		return (
			<PostHogProvider apiKey={posthogAPIKey} options={POSTHOG_OPTIONS}>
				{children}
			</PostHogProvider>
		);
	}

	return children;
}
