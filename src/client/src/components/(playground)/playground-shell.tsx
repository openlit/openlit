"use client";

import type { ReactNode } from "react";
import Sidebar from "@/components/(playground)/sidebar";
import SidebarBrand from "@/components/(playground)/sidebar-brand";
import { HeaderContextRow } from "@/components/(playground)/header";
import {
	SidebarLayoutProvider,
	useSidebarLayout,
} from "@/components/(playground)/sidebar-layout-context";
import { cn } from "@/lib/utils";

function PlaygroundShellFrame({ children }: { children: ReactNode }) {
	const { sidebarWidthClass } = useSidebarLayout();

	return (
		<div className="flex h-screen w-full flex-col overflow-hidden border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950">
			<div className="flex shrink-0 border-b border-stone-200 dark:border-stone-800">
				<div
					className={cn(
						"relative shrink-0 border-r border-stone-200 dark:border-stone-800",
						sidebarWidthClass
					)}
				>
					<SidebarBrand />
				</div>
				<HeaderContextRow />
			</div>
			<div className="flex min-h-0 flex-1">
				<div
					className={cn(
						"relative z-30 flex shrink-0 flex-col border-r border-stone-200 dark:border-stone-800",
						sidebarWidthClass
					)}
				>
					<Sidebar />
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{children}
					</main>
				</div>
			</div>
		</div>
	);
}

export default function PlaygroundShell({ children }: { children: ReactNode }) {
	return (
		<SidebarLayoutProvider>
			<PlaygroundShellFrame>{children}</PlaygroundShellFrame>
		</SidebarLayoutProvider>
	);
}
