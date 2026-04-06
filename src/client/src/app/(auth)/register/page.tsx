"use client";
import { Suspense, useEffect } from "react";
import { AuthForm } from "@/components/(auth)/auth-form";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

export default function Register() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.REGISTER_PAGE_VISITED);
	}, []);

	return (
		<Suspense fallback={null}>
			<AuthForm type={"register"} />
		</Suspense>
	);
}
