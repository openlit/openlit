"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { usePageHeader } from "@/selectors/page";
import { generatePageHeader } from "@/utils/breadcrumbs";
import { getActiveApp } from "@/utils/active-app";
import { HeaderScopeSeparator } from "./header-scope-pill";

export default function HeaderPageTrail() {
	const pathname = usePathname();
	const { header, setHeader } = usePageHeader();
	const activeApp = getActiveApp(pathname);

	useEffect(() => {
		const pageHeader = generatePageHeader(pathname);
		setHeader(pageHeader);
	}, [pathname, setHeader]);

	const breadcrumbs = header.breadcrumbs.filter(
		(crumb) =>
			!(
				activeApp &&
				(crumb.href === activeApp.href || crumb.title === activeApp.title)
			)
	);
	const showTitle =
		Boolean(header.title?.trim()) &&
		header.title !== activeApp?.title &&
		!breadcrumbs.some((crumb) => crumb.title === header.title);

	if (breadcrumbs.length === 0 && !showTitle) {
		return null;
	}

	return (
		<>
			{breadcrumbs.map(({ title, href }) => (
				<span key={href} className="contents">
					<HeaderScopeSeparator />
					<Link
						href={href}
						className="max-w-40 truncate text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
					>
						{title}
					</Link>
				</span>
			))}
			{showTitle ? (
				<>
					<HeaderScopeSeparator />
					<span className="max-w-56 truncate text-xs font-semibold text-stone-900 dark:text-white">
						{header.title}
					</span>
				</>
			) : null}
		</>
	);
}
