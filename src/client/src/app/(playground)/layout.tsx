import { Suspense } from "react";
import Sidebar from "@/components/(playground)/sidebar";
import Header from "@/components/(playground)/header";
import ClickhouseConnectivityWrapper from "@/components/(playground)/clickhouse-connectivity-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";
import CustomPostHogProvider from "@/components/(playground)/posthog";
import NavigationEvents from "@/components/common/navigation-events";
import AppInit from "@/components/common/app-init";
import NavMenus from "@/components/(playground)/nav-menus";

export default async function PlaygroundLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

	return (
		<CustomPostHogProvider telemetryEnabled={telemetryEnabled}>
			<TooltipProvider>
				<div className="flex h-screen w-full overflow-hidden">
					<div className="flex flex-col grow w-full">
						<Header />
						<main className="flex flex-col grow flex-1 items-start p-4 sm:px-6 overflow-hidden">
							<NavMenus />
							<ClickhouseConnectivityWrapper />
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
