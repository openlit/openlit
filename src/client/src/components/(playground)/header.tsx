"use client";
import { useEffect, useRef } from "react";
import RouteBreadcrumbs from "./route-breadcrumbs";
import { usePortal } from "./header-portal";
import OrganisationSwitch from "./sidebar/organisation-switch";
import HeaderProjectSwitch from "./header-project-switch";
import DatabaseConfigSwitch from "./sidebar/database-config-switch";

export default function Header() {
	const { setHeaderRef } = usePortal();
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      setHeaderRef(containerRef.current);
    }
  }, [setHeaderRef]);

	return (
		<header className="mb-2 flex w-full flex-col gap-1.5">
			<div className="flex min-w-0 items-center gap-2">
				<OrganisationSwitch
					contentAlign="start"
					contentSide="bottom"
					className="border-stone-200 bg-stone-100/50 text-stone-700 hover:bg-stone-200 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-200 dark:hover:bg-stone-800 dark:hover:text-white"
				/>
				<span className="text-sm text-stone-400 dark:text-stone-600">/</span>
				<HeaderProjectSwitch />
				<span className="text-sm text-stone-400 dark:text-stone-600">/</span>
				<DatabaseConfigSwitch
					contentAlign="start"
					contentSide="bottom"
					className="border-stone-200 bg-stone-100/50 text-stone-700 hover:bg-stone-200 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-200 dark:hover:bg-stone-800 dark:hover:text-white"
				/>
				<div ref={containerRef} className="ml-auto flex items-center" />
			</div>
			<div className="min-w-0">
				<RouteBreadcrumbs />
			</div>
		</header>
	);
}
