"use client";
import { DEFAULT_LOGGED_IN_ROUTE } from "@/constants/route";
import asaw from "@/utils/asaw";
import { getProviders, signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import {
	GithubMark,
	GoogleMark,
	MicrosoftMark,
	OktaMark,
} from "@/components/(auth)/provider-marks";

const getErrors = () => {
	const m = getMessage();
	return {
		AccessDenied: m.AUTH_ERROR_ACCESS_DENIED,
		Signin: m.AUTH_ERROR_TRY_DIFFERENT,
		OAuthSignin: m.AUTH_ERROR_TRY_DIFFERENT,
		OAuthCallback: m.AUTH_ERROR_TRY_DIFFERENT,
		OAuthCreateAccount: m.AUTH_ERROR_TRY_DIFFERENT,
		EmailCreateAccount: m.AUTH_ERROR_TRY_DIFFERENT,
		Callback: m.AUTH_ERROR_TRY_DIFFERENT,
		OAuthAccountNotLinked: m.AUTH_ERROR_CONFIRM_IDENTITY,
		EmailSignin: m.AUTH_ERROR_CHECK_EMAIL,
		CredentialsSignin: m.AUTH_ERROR_CREDENTIALS,
		Configuration: m.AUTH_ERROR_CONFIGURATION,
		default: m.AUTH_ERROR_DEFAULT,
	};
};

const SignInError = ({ error }: { error: string }) => {
	if (!error || error === "undefined") return null;
	const errors = getErrors();
	const errorMessage = errors[error as keyof typeof errors] ?? error ?? errors.default;
	return <div className="text-xs text-red-600 dark:text-red-400 text-center bg-red-50 dark:bg-red-950/30 p-3 rounded-md">{errorMessage}</div>;
};

export function AuthForm({ type }: { type: "login" | "register" }) {
	const posthog = usePostHog();
	const searchParams = useSearchParams();
	const callbackUrl: string =
		(searchParams.get("callbackUrl") as string) || DEFAULT_LOGGED_IN_ROUTE;
	const errorType: string = (searchParams.get("error") as string);
	const [error, setError] = useState<string>(errorType || "");
	const [pendingProvider, setPendingProvider] = useState<string | null>(null);
	const [providers, setProviders] = useState<string[]>([]);
	const m = getMessage();

	useEffect(() => {
		const fetchProviders = async () => {
			const res = await getProviders();
			if (typeof res === "object" && res !== null) {
				setProviders(Object.keys(res).filter(e => !["login", "register"].includes(e)));
			}
		};
		fetchProviders();
	}, []);

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

	const oauthButtons = [
		{
			id: "google",
			label: m.AUTH_CONTINUE_WITH_GOOGLE,
			error: m.AUTH_ERROR_GOOGLE,
			icon: <GoogleMark className="size-5" />,
		},
		{
			id: "github",
			label: m.AUTH_CONTINUE_WITH_GITHUB,
			error: m.AUTH_ERROR_GITHUB,
			icon: <GithubMark className="size-5" />,
		},
		{
			id: "azure-ad",
			label: m.AUTH_CONTINUE_WITH_MICROSOFT,
			error: m.AUTH_ERROR_MICROSOFT,
			icon: <MicrosoftMark className="size-5" />,
		},
		{
			id: "okta",
			label: m.AUTH_CONTINUE_WITH_OKTA,
			error: m.AUTH_ERROR_OKTA,
			icon: <OktaMark className="size-5" />,
		},
	];

	async function handleOAuthSignIn(provider: { id: string; error: string }) {
		setPendingProvider(provider.id);
		setError("");

		try {
			const result = await signIn(provider.id, {
				callbackUrl,
				redirect: false,
			});

			if (result?.error) {
				console.error("OAuth sign-in error:", provider.id);
				setError(result.error);
			}
		} catch {
			console.error("OAuth sign-in exception:", provider.id);
			setError(provider.error);
		} finally {
			setPendingProvider(null);
		}
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
		<div className="grid w-full gap-6 text-stone-900 dark:text-stone-100">
			{error && <SignInError error={error} />}

			{providers.length > 0 && (
				<TooltipProvider>
					<div className="flex flex-wrap items-center justify-center gap-3">
						{oauthButtons.filter((provider) => providers.includes(provider.id)).map((provider) => (
							<Tooltip key={provider.id} delayDuration={100}>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="icon"
										aria-label={provider.label}
										aria-busy={pendingProvider === provider.id}
										onClick={() => handleOAuthSignIn(provider)}
										disabled={pendingProvider !== null}
										className="size-11 rounded-md border-stone-200 bg-white text-stone-900 hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-100"
									>
										{pendingProvider === provider.id ? (
											<Loader2 className="size-5 animate-spin" aria-hidden="true" />
										) : (
											provider.icon
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom" className="text-xs">
									{provider.label}
								</TooltipContent>
							</Tooltip>
						))}
					</div>
				</TooltipProvider>
			)}

			{/* Divider */}
			{
				providers.length > 0 && (
					<div className="relative">
						<div className="absolute inset-0 flex items-center">
							<span className="w-full border-t border-stone-300 dark:border-stone-700" />
						</div>
						<div className="relative flex justify-center text-xs uppercase">
							<span className="bg-white dark:bg-stone-950 px-2 text-stone-500 dark:text-stone-400">{m.AUTH_OR}</span>
						</div>
					</div>
				)
			}

			<form
				action={type === "login" ? login : register}
				className="flex flex-col"
			>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="email">{m.AUTH_EMAIL}</Label>
						<Input
							className="ph-no-capture"
							id="email"
							name="email"
							type="email"
							placeholder={m.AUTH_EMAIL_PLACEHOLDER}
							autoComplete="email"
							required
						/>
					</div>
					<div className="grid gap-2">
						<div className="flex items-center">
							<Label htmlFor="password">{m.AUTH_PASSWORD}</Label>
						</div>
						<Input
							className="ph-no-capture"
							autoComplete="current-password"
							id="password"
							name="password"
							type="password"
							placeholder={m.AUTH_PASSWORD_PLACEHOLDER}
							required
						/>
					</div>
					<Button
						type="submit"
						className="w-full rounded-md bg-primary text-white hover:bg-primary/90 dark:bg-primary dark:text-white dark:hover:bg-primary/90"
					>
						{type === "login" ? m.AUTH_SIGN_IN : m.AUTH_SIGN_UP}
					</Button>
				</div>
			</form>
			<div className="text-sm text-stone-600 dark:text-stone-400">
				{type === "login"
					? `${m.AUTH_NO_ACCOUNT} `
					: m.AUTH_HAVE_ACCOUNT}{" "}
				<Link
					href={type === "login" ? "/register" : "/login"}
					className="ml-auto inline-block text-sm underline text-primary"
				>
					{type === "login" ? ` ${m.AUTH_SIGN_UP}` : ` ${m.AUTH_SIGN_IN}`}
				</Link>
			</div>
		</div>
	);
}
