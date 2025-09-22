"use client";
import { usePathname } from "next/navigation";
import RefreshRate from "./filter/refresh-rate";
import { useEffect } from "react";
import { usePageHeader } from "@/selectors/page";
import DescriptionTooltip from "../common/description-tooltip";
import RouteBreadcrumbs from "./route-breadcrumbs";

const DashboardTitleMap = {
	"d": "Dashboard",
};

export default function Header() {
	// const pathname = usePathname();
	// const { header, setHeader } = usePageHeader();

	// useEffect(() => {
	// 	const titleKey = pathname.substring(1).replaceAll("-", " ").split("/")[0];
	// 	setHeader({
	// 		title: DashboardTitleMap[titleKey as keyof typeof DashboardTitleMap] || titleKey,
	// 		breadcrumbs: [],
	// 	});
	// }, [pathname, setHeader]);

	return (
		<header className="flex flex flex-col w-full mb-2">
			{/* <div className="flex items-center gap-2 grow px-4 h-11">
				<div className="flex items-center gap-2 grow">
					<h1 className="text-xl font-semibold capitalize dark:text-white">{header.title}</h1>
					{header.description && (
						<DescriptionTooltip description={header.description} className="ml-2 h-4 w-4 text-stone-900 dark:text-stone-300" />
					)}
				</div>
				<RefreshRate />
			</div> */}
			<RouteBreadcrumbs />
		</header>
	);
}
