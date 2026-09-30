"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import getMessage from "@/constants/messages";
import { DEFAULT_LOGGED_IN_ROUTE } from "@/constants/route";
import CheckeredBackground from "@/components/common/checkered-background";
import { Button } from "@/components/ui/button";

const primaryActionClassName =
	"bg-primary text-white hover:bg-primary/90 dark:bg-primary dark:text-white dark:hover:bg-primary/90";

function ErrorPageCard({
	code,
	title,
	description,
	reference,
	loggedIn,
	onRetry,
}: {
	code: string;
	title: string;
	description: string;
	reference?: string;
	loggedIn: boolean;
	onRetry?: () => void;
}) {
	const m = getMessage();

	return (
		<div className="rounded-xl border border-stone-200 bg-white p-6 text-center shadow-sm dark:border-stone-800 dark:bg-stone-950 sm:p-8">
			<p className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
				{code}
			</p>
			<h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
				{title}
			</h1>
			<p className="mt-1.5 text-sm leading-6 text-stone-500 dark:text-stone-400">
				{description}
			</p>
			<div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
				{onRetry ? (
					<Button
						type="button"
						onClick={onRetry}
						className={`gap-1.5 ${primaryActionClassName}`}
					>
						<RotateCcw className="size-3.5" />
						{m.ERROR_PAGE_TRY_AGAIN}
					</Button>
				) : null}
				<Button
					asChild
					variant={onRetry ? "outline" : "default"}
					className={onRetry ? undefined : primaryActionClassName}
				>
					<Link href={loggedIn ? DEFAULT_LOGGED_IN_ROUTE : "/login"}>
						{loggedIn ? m.ERROR_PAGE_GO_TO_DASHBOARD : m.ERROR_PAGE_GO_TO_SIGN_IN}
					</Link>
				</Button>
			</div>
			{reference ? (
				<p className="mt-6 border-t border-stone-200 pt-4 font-mono text-[10px] text-stone-400 dark:border-stone-800 dark:text-stone-500">
					{m.ERROR_PAGE_REFERENCE}: {reference}
				</p>
			) : null}
		</div>
	);
}

export function NotFoundCard({ loggedIn }: { loggedIn: boolean }) {
	const m = getMessage();

	return (
		<ErrorPageCard
			code={m.ERROR_PAGE_NOT_FOUND_CODE}
			title={m.ERROR_PAGE_NOT_FOUND_TITLE}
			description={m.ERROR_PAGE_NOT_FOUND_DESCRIPTION}
			loggedIn={loggedIn}
		/>
	);
}

export function ServerErrorCard({
	loggedIn,
	reference,
	onRetry,
}: {
	loggedIn: boolean;
	reference?: string;
	onRetry: () => void;
}) {
	const m = getMessage();

	return (
		<ErrorPageCard
			code={m.ERROR_PAGE_SERVER_ERROR_CODE}
			title={m.ERROR_PAGE_SERVER_ERROR_TITLE}
			description={m.ERROR_PAGE_SERVER_ERROR_DESCRIPTION}
			reference={reference}
			loggedIn={loggedIn}
			onRetry={onRetry}
		/>
	);
}

export function DashboardErrorFrame({ children }: { children: ReactNode }) {
	return (
		<div className="relative min-h-0 w-full flex-1 overflow-hidden">
			<CheckeredBackground fade="stone" />
			<div className="absolute inset-0 flex flex-col items-center overflow-y-auto overflow-x-hidden px-4 py-10 sm:px-6">
				<div className="relative my-auto w-full max-w-md">{children}</div>
			</div>
		</div>
	);
}
