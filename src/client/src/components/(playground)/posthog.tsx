"use client";
import {
	NEXT_PUBLIC_POSTHOG_API_HOST,
	NEXT_PUBLIC_POSTHOG_API_KEY,
} from "@/constants/posthog";
import { PostHogConfig } from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { ReactNode } from "react";

const POSTHOG_OPTIONS: Partial<PostHogConfig> = {
	api_host: NEXT_PUBLIC_POSTHOG_API_HOST,
	autocapture: false,
};

export default function CustomPostHogProvider({
	children,
	telemetryEnabled,
}: {
	children: ReactNode;
	telemetryEnabled: boolean;
}) {
	if (telemetryEnabled) {
		return (
			<PostHogProvider
				apiKey={NEXT_PUBLIC_POSTHOG_API_KEY}
				options={POSTHOG_OPTIONS}
			>
				{children}
			</PostHogProvider>
		);
	}

	return children as JSX.Element;
}
