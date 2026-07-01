"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSetDashboardPageSearch } from "@/selectors/dashboards";
import Search from "@/components/(playground)/manage-dashboard/common/search";
import {
	DashboardHeaderActionsProvider,
	useDashboardHeaderActions,
} from "@/components/(playground)/manage-dashboard/dashboard-header-actions-context";
import {
	DASHBOARD_VIEWS,
	getActiveDashboardView,
} from "@/components/(playground)/manage-dashboard/dashboard-views";
import RootActions from "@/components/(playground)/manage-dashboard/explorer/root-actions";
import { cn } from "@/lib/utils";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";

function DashboardLayoutFrame({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const setPageSearch = useSetDashboardPageSearch();
	const { actions } = useDashboardHeaderActions();
	const activeView = getActiveDashboardView(pathname);
	const ActiveIcon = activeView.icon;

	const resetSearch = () => setPageSearch("");

	const openCreate = () => {
		if (actions?.onCreate) {
			actions.onCreate();
			return;
		}
		router.push("/dashboards/explorer");
	};

	if (pathname.includes("/dashboards/board/")) {
		return <>{children}</>;
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<FeaturePageHeader
				eyebrow="Dashboards"
				title={activeView.label}
				icon={<ActiveIcon className="h-4 w-4" />}
				tone={activeView.tone}
				actions={(
					<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
						<div className="flex flex-wrap items-center gap-2">
							{DASHBOARD_VIEWS.map((view) => {
								const Icon = view.icon;
								const isActive = view.key === activeView.key;
								return (
									<Link
										key={view.key}
										href={view.href}
										onClick={resetSearch}
										className={cn(
											"inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition",
											isActive
												? view.tone
												: "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
										)}
									>
										<Icon className="size-4" />
										<span className="font-medium">{view.label}</span>
									</Link>
								);
							})}
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Search />
							<RootActions
								openAddDialog={openCreate}
								importBoardLayout={actions?.onImport}
							/>
						</div>
					</div>
				)}
			/>
			<section className="min-h-0 flex-1 overflow-auto p-4">
				{children}
			</section>
		</div>
	);
}

export default function LayoutManageDashboard({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<DashboardHeaderActionsProvider>
			<DashboardLayoutFrame>{children}</DashboardLayoutFrame>
		</DashboardHeaderActionsProvider>
	);
}
