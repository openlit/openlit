"use client";
import type { ReactNode } from "react";
import { BookOpen, GithubIcon, Phone } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import getMessage from "@/constants/messages";
import { FOUNDER_SCHEDULE_URL } from "@/constants/external-links";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

const authActionClassName =
	"inline-flex size-8 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-white";

const CHECKER_SIZE = 32;

const checkerSparkle = encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${CHECKER_SIZE}" height="${CHECKER_SIZE}"><path d="M16 12.5Q16.5 15.5 19.5 16Q16.5 16.5 16 19.5Q15.5 16.5 12.5 16Q15.5 15.5 16 12.5Z" fill="rgba(168,162,158,0.25)"/></svg>`
);

const checkeredBackgroundStyle = {
	backgroundImage: `url("data:image/svg+xml,${checkerSparkle}"), linear-gradient(to right, rgba(168,162,158,0.11) 1px, transparent 1px), linear-gradient(to bottom, rgba(168,162,158,0.05) 1px, transparent 1px)`,
	backgroundSize: `${CHECKER_SIZE}px ${CHECKER_SIZE}px`,
	backgroundPosition: `-${CHECKER_SIZE / 2 - 0.5}px -${CHECKER_SIZE / 2 - 0.5}px, 0 0, 0 0`,
};

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
	const pathname = usePathname();
	const pageLabel = pathname?.startsWith("/register")
		? m.AUTH_SIGN_UP
		: m.AUTH_SIGN_IN;

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
						{pageLabel}
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
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0"
					style={checkeredBackgroundStyle}
				/>
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,white_100%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(12,10,9)_100%)]"
				/>
				<div className="absolute inset-0 flex flex-col items-center overflow-y-auto overflow-x-hidden px-4 py-10 sm:px-6">
					<div className="relative my-auto w-full max-w-md">
						<div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-950 sm:p-8">
							<h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
								{m.AUTH_WELCOME}
							</h1>
							<p className="mt-1.5 text-sm leading-6 text-stone-500 dark:text-stone-400">
								{m.AUTH_SUBTITLE}
							</p>
							<div className="mt-6">{children}</div>
						</div>
						<p className="mt-4 text-center font-mono text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500">
							{m.AUTH_FOOTER}
						</p>
					</div>
				</div>
			</main>
		</div>
	);
}
