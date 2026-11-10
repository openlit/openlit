"use client";
import { Suspense, useEffect } from "react";
import { AuthForm } from "@/components/(auth)/auth-form";
import AuthFormContainer from "@/components/(auth)/auth-form-container";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

export default function Login() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.LOGIN_PAGE_VISITED);
	}, []);

	return (
		<AuthFormContainer>
			<Suspense fallback={null}>
				<AuthForm type={"login"} />
			</Suspense>
		</AuthFormContainer>
	);
}
