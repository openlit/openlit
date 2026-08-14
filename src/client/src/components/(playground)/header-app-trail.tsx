"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveApp } from "@/utils/active-app";
import { headerScopeTriggerClassName, HeaderScopeSeparator } from "./header-scope-pill";

export default function HeaderAppTrail() {
	const pathname = usePathname();
	const activeApp = getActiveApp(pathname);

	if (!activeApp) {
		return null;
	}

	return (
		<>
			<HeaderScopeSeparator />
			<Link href={activeApp.href} className={headerScopeTriggerClassName}>
				<span className="min-w-0 truncate">{activeApp.title}</span>
			</Link>
		</>
	);
}
