"use client";
import RouteBreadcrumbs from "./route-breadcrumbs";

export default function Header() {

	return (
		<header className="flex flex flex-col w-full mb-2">
			<RouteBreadcrumbs />
		</header>
	);
}
