"use client";
import type { ReactNode } from "react";
import { BookOpen, GithubIcon, Phone } from "lucide-react";
import Image from "next/image";
import getMessage from "@/constants/messages";
import { FOUNDER_SCHEDULE_URL } from "@/constants/external-links";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

const authActionClassName =
	"inline-flex h-10 w-full items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800";

function AuthIconLink({
	href,
	label,
	children,
}: {
	href: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<a
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={label}
					className={authActionClassName}
				>
					{children}
				</a>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="text-xs">
				<p>{label}</p>
			</TooltipContent>
		</Tooltip>
	);
}

export default function AuthFormContainer({
	children,
}: {
	children: JSX.Element;
}) {
	const m = getMessage();
	return (
		<div className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-stone-100 px-6 py-12 dark:bg-stone-900 sm:px-10">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(243,108,6,0.12),transparent_52%)]"
			/>
			<div className="relative mx-auto flex w-full max-w-lg flex-col rounded-xl border border-stone-200 bg-white p-8 shadow-sm dark:border-stone-800 dark:bg-stone-950">
				<div className="mb-8 flex items-center gap-2.5 lg:hidden">
					<Image
						src="/images/logo.png"
						alt=""
						width="28"
						height="28"
						className="object-cover"
					/>
					<span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
						OpenLIT
					</span>
				</div>
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
						{m.AUTH_WELCOME}
					</h1>
					<p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
						{m.AUTH_SUBTITLE}
					</p>
				</div>
				<div className="mt-8">{children}</div>
				<TooltipProvider>
					<div className="mt-8 grid grid-cols-3 gap-2 border-t border-stone-200 pt-6 dark:border-stone-800">
						<AuthIconLink href={FOUNDER_SCHEDULE_URL} label={m.TALK_TO_FOUNDER}>
							<Phone className="size-4" />
						</AuthIconLink>
						<AuthIconLink
							href="https://github.com/openlit/openlit"
							label={m.AUTH_GITHUB}
						>
							<GithubIcon className="size-4" />
						</AuthIconLink>
						<AuthIconLink
							href="https://docs.openlit.io/latest/overview"
							label={m.AUTH_DOCUMENTATION}
						>
							<BookOpen className="size-4" />
						</AuthIconLink>
					</div>
				</TooltipProvider>
			</div>
		</div>
	);
}
