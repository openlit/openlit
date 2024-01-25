"use client";
import Link from "next/link";
import { Form } from "../form";
import { signIn } from "next-auth/react";

export default function Login() {
	async function register(formData: FormData) {
		signIn("register", {
			callbackUrl: "/dashboard",
			email: formData.get("email") as string,
			password: formData.get("password") as string,
		});
	}

	return (
		<div className="flex h-screen w-screen items-center justify-center">
			<div className="z-10 w-full max-w-md overflow-hidden rounded-2xl dark:text-gray-200 shadow-xl bg-gray-900">
				<div className="flex flex-col items-center justify-center space-y-3 px-4 py-6 pt-8 text-center sm:px-16">
					<h3 className="text-xl font-semibold">Sign Up</h3>
					<p className="text-sm text-gray-500">
						Create an account with your email and password
					</p>
				</div>
				<Form action={register}>
					<button type="submit" className="dark:text-gray-200 bg-gray-600 p-3">Sign Up</button>
					<p className="text-center text-sm text-gray-600">
						{"Already have an account? "}
						<Link href="/login" className="font-semibold text-gray-600">
							Sign in
						</Link>
						{" instead."}
					</p>
				</Form>
			</div>
		</div>
	);
}
