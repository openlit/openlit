"use client";

import { Suspense } from "react";
import Sidebar from "@/components/(playground)/sidebar";
import Header from "@/components/(playground)/header";
import ClickhouseConnectivityWrapper from "@/components/(playground)/clickhouse-connectivity-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";
import CustomPostHogProvider from "@/components/(playground)/posthog";
import NavigationEvents from "@/components/common/navigation-events";
import AppInit from "@/components/common/app-init";
import NavMenus from "@/components/(playground)/nav-menus";
import { useDemoAccount } from "@/contexts/demo-account-context";

export default function PlaygroundLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";
	const { isDemoAccount } = useDemoAccount();

	return (
		<CustomPostHogProvider telemetryEnabled={telemetryEnabled}>
			<TooltipProvider>
				<div className={`flex h-screen w-full overflow-hidden ${!isDemoAccount && "pl-10"}`}>
					<div className="flex flex-col grow w-full">
						<Header />
						{!isDemoAccount && <Sidebar />}
						<main className={`flex flex-col grow flex-1 items-start p-4 sm:px-6 overflow-hidden`}>
							{isDemoAccount && <NavMenus />}
							{!isDemoAccount && <ClickhouseConnectivityWrapper />}
							{children}
						</main>
					</div>
				</div>
			</TooltipProvider>
			<Suspense fallback={null}>
				<NavigationEvents />
				<AppInit />
			</Suspense>
		</CustomPostHogProvider>
	);
}
