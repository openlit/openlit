"use client";
import type { ReactNode } from "react";
import { BookOpen, GithubIcon, Phone } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import getMessage from "@/constants/messages";
import { FOUNDER_SCHEDULE_URL } from "@/constants/external-links";
import CheckeredBackground from "@/components/common/checkered-background";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

const authActionClassName =
	"inline-flex size-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-white";

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

export default function AuthShell({
	children,
	pageLabel,
}: {
	children: ReactNode;
	pageLabel?: string;
}) {
	const m = getMessage();
	const pathname = usePathname();
	const label =
		pageLabel ??
		(pathname?.startsWith("/register") ? m.AUTH_SIGN_UP : m.AUTH_SIGN_IN);

	return (
		<div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top)] dark:bg-stone-950 md:pt-0">
			<header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white px-4 dark:border-stone-800 dark:bg-stone-950 sm:px-6">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex items-center gap-2">
						<Image
							src="/images/logo.png"
							alt=""
							width="28"
							height="28"
							className="size-7 shrink-0 object-contain"
						/>
						<span className="text-base font-semibold text-stone-950 dark:text-white">
							OpenLIT
						</span>
					</div>
					<span className="text-xs text-stone-400 dark:text-stone-600">/</span>
					<span className="truncate text-xs font-semibold text-stone-950 dark:text-white">
						{label}
					</span>
				</div>
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						<AuthIconLink href={FOUNDER_SCHEDULE_URL} label={m.TALK_TO_FOUNDER}>
							<Phone className="size-3.5" />
						</AuthIconLink>
						<AuthIconLink
							href="https://github.com/openlit/openlit"
							label={m.AUTH_GITHUB}
						>
							<GithubIcon className="size-3.5" />
						</AuthIconLink>
						<AuthIconLink
							href="https://docs.openlit.io/latest/overview"
							label={m.AUTH_DOCUMENTATION}
						>
							<BookOpen className="size-3.5" />
						</AuthIconLink>
					</div>
				</TooltipProvider>
			</header>

			<main className="relative min-h-0 flex-1 overflow-hidden">
				<CheckeredBackground />
				<div className="absolute inset-0 flex flex-col items-center overflow-y-auto overflow-x-hidden px-4 py-10 sm:px-6">
					<div className="relative my-auto w-full max-w-md">{children}</div>
				</div>
			</main>
		</div>
	);
}
