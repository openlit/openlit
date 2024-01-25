"use client";
import Link from "next/link";
import { Form } from "../form";
import { signIn } from "next-auth/react";
import asaw from "@/utils/asaw";

export default function Login() {
	const login = async (formData: FormData) => {
		await asaw(
			signIn("login", {
				callbackUrl: "/dashboard",
				email: formData.get("email") as string,
				password: formData.get("password") as string,
			})
		);
	};
	return (
		<div className="flex h-screen w-screen items-center justify-center">
			<div className="z-10 w-full max-w-md overflow-hidden rounded-2xl dark:text-gray-200 shadow-xl bg-gray-900">
				<div className="flex flex-col items-center justify-center space-y-3  px-4 py-6 pt-8 text-center sm:px-16">
					<h3 className="text-xl font-semibold">Sign In</h3>
					<p className="text-sm text-gray-500">
						Use your email and password to sign in
					</p>
				</div>
				<Form action={login}>
					<button type="submit" className="dark:text-gray-200 bg-gray-600 p-3">Sign in</button>
					<p className="text-center text-sm text-gray-600">
						{"Don't have an account? "}
						<Link href="/register" className="font-semibold text-gray-600">
							Sign up
						</Link>
						{" for free."}
					</p>
				</Form>
			</div>
		</div>
	);
}
