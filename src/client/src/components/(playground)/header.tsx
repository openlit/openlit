"use client";
import { useEffect, useRef } from "react";
import { usePortal } from "./header-portal";
import OrganisationSwitch from "./sidebar/organisation-switch";
import HeaderProjectSwitch from "./header-project-switch";
import DatabaseConfigSwitch from "./sidebar/database-config-switch";
import HeaderAppTrail from "./header-app-trail";
import HeaderPageTrail from "./header-page-trail";
import { HeaderScopeSeparator } from "./header-scope-pill";
import { playgroundTopBarClassName } from "./sidebar-layout-context";

export function HeaderContextRow() {
	const { setHeaderRef } = usePortal();
	const containerRef = useRef(null);

	useEffect(() => {
		if (containerRef.current) {
			setHeaderRef(containerRef.current);
		}
	}, [setHeaderRef]);

	return (
		<div
			className={playgroundTopBarClassName(
				"min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 pl-6 pr-3"
			)}
		>
			<OrganisationSwitch contentAlign="start" contentSide="bottom" />
			<HeaderScopeSeparator />
			<HeaderProjectSwitch />
			<HeaderScopeSeparator />
			<DatabaseConfigSwitch contentAlign="start" contentSide="bottom" />
			<HeaderAppTrail />
			<HeaderPageTrail />
			<div ref={containerRef} className="ml-auto flex items-center" />
		</div>
	);
}
