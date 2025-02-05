"use client";
import { DEFAULT_LOGGED_IN_ROUTE } from "@/constants/route";
import asaw from "@/utils/asaw";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

const errors = {
	AccessDenied: "Access denied for this account.",
	Signin: "Try signing with a different account.",
	OAuthSignin: "Try signing with a different account.",
	OAuthCallback: "Try signing with a different account.",
	OAuthCreateAccount: "Try signing with a different account.",
	EmailCreateAccount: "Try signing with a different account.",
	Callback: "Try signing with a different account.",
	OAuthAccountNotLinked:
		"To confirm your identity, sign in with the same account you used originally.",
	EmailSignin: "Check your email address.",
	CredentialsSignin:
		"Sign in failed. Check the details you provided are correct.",
	default: "Unable to sign in.",
};

const SignInError = ({ error }: { error: keyof typeof errors }) => {
	const errorMessage = error && (errors[error] ?? errors.default);
	return <div className="text-xs text-red-600 text-center">{errorMessage}</div>;
};

export function AuthForm({ type }: { type: "login" | "register" }) {
	const posthog = usePostHog();
	const searchParams = useSearchParams();
	const callbackUrl: string =
		(searchParams.get("callbackUrl") as string) || DEFAULT_LOGGED_IN_ROUTE;
	const [error, setError] = useState<string>("");
	async function authWrapper(fn: any) {
		const [err, response] = await asaw(fn());

		if (err) {
			setError(err.toString());
			return;
		}

		if (!response.ok) {
			setError(response.error);
			return;
		}

		posthog?.capture(
			type === "login" ? CLIENT_EVENTS.LOGIN : CLIENT_EVENTS.REGISTER
		);
		window.location.replace(callbackUrl);
	}
	async function login(formData: FormData) {
		authWrapper(() =>
			signIn("login", {
				callbackUrl,
				email: formData.get("email") as string,
				password: formData.get("password") as string,
				redirect: false,
			})
		);
	}

	async function register(formData: FormData) {
		authWrapper(() =>
			signIn("register", {
				callbackUrl,
				email: formData.get("email") as string,
				password: formData.get("password") as string,
				redirect: false,
			})
		);
	}

	return (
		<div className="mx-auto grid gap-6 w-[350px] text-stone-900">
			<div className="grid gap-2 text-center">
			</div>
			{error && <SignInError error={error as keyof typeof errors} />}
			<form
				action={type === "login" ? login : register}
				className="flex flex-col"
			>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="email">Email</Label>
						<Input
							className="ph-no-capture dark:bg-white dark:border-stone-200"
							id="email"
							name="email"
							type="email"
							placeholder="user@openlit.io"
							autoComplete="email"
							required
						/>
					</div>
					<div className="grid gap-2">
						<div className="flex items-center">
							<Label htmlFor="password">Password</Label>
						</div>
						<Input
							className="ph-no-capture dark:bg-white dark:border-stone-200"
							autoComplete="current-password"
							id="password"
							name="password"
							type="password"
							placeholder="********"
							required
						/>
					</div>
					<Button
						type="submit"
						className="w-full bg-primary dark:bg-primary text-white dark:text-white hover:dark:bg-primary rounded-full dark:hover:bg-stone-900/90"
					>
						{type === "login" ? "Sign in" : "Sign Up"}
					</Button>
				</div>
			</form>
			<div className="text-center text-sm">
				{type === "login"
					? "Don't have an account? "
					: "Already have an account?"}{" "}
				<Link
					href={type === "login" ? "/register" : "/login"}
					className="ml-auto inline-block text-sm underline text-primary"
				>
					{type === "login" ? " Sign up" : " Sign in"}
				</Link>
			</div>
		</div>
	);
}
