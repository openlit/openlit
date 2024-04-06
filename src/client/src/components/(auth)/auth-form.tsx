"use client";
import { DEFAULT_LOGGED_IN_ROUTE } from "@/constants/route";
import asaw from "@/utils/asaw";
import { signIn } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

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
		<div className="flex min-h-screen items-center justify-center bg-secondary p-8">
			<div className="z-10 w-full max-w-md overflow-hidden rounded-xl bg-tertiary text-secondary">
				<div className="flex flex-col items-center justify-center space-y-3 px-4 py-6 pt-8 text-center">
					<Image
						alt="doku"
						src="/images/doku-logo-with-name.png"
						width={836}
						height={298}
					/>
					<p className="text-sm">
						{type === "login"
							? "Use your email and password to sign in"
							: "Create an account to enter"}
					</p>
				</div>
				{error && <SignInError error={error as keyof typeof errors} />}
				<form
					action={type === "login" ? login : register}
					className="flex flex-col space-y-4 px-4 py-8 sm:px-16"
				>
					<div className="flex flex-col w-full items-start">
						<label htmlFor="email" className="block text-xs uppercase">
							Email Address
						</label>
						<input
							id="email"
							name="email"
							type="email"
							placeholder="user@doku.com"
							autoComplete="email"
							required
							className="mt-1 block w-full appearance-none px-3 py-2 placeholder-secondary/[0.3] focus:outline-none bg-secondary/[0.05]"
						/>
					</div>
					<div className="flex flex-col w-full items-start">
						<label htmlFor="password" className="block text-xs uppercase">
							Password
						</label>
						<input
							autoComplete="current-password"
							id="password"
							name="password"
							type="password"
							placeholder="********"
							required
							className="mt-1 block w-full appearance-none px-3 py-2 placeholder-secondary/[0.3] focus:outline-none bg-secondary/[0.05]"
						/>
					</div>
					<button type="submit" className="p-2 bg-primary text-white rounded">
						{type === "login" ? "Sign in" : "Sign Up"}
					</button>
					<p className="text-center text-sm">
						{type === "login"
							? "Don't have an account? "
							: "Already have an account?"}
						<Link
							href={type === "login" ? "/register" : "/login"}
							className="font-semibold text-secondary"
						>
							{type === "login" ? " Sign up" : " Sign in"}
						</Link>
					</p>
				</form>
			</div>
		</div>
	);
}
