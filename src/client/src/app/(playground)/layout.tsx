import Sidebar from "@/components/(playground)/sidebar";
import Header from "@/components/(playground)/header";
import { Suspense } from "react";
import ClickhouseConnectivityWrapper from "@/components/(playground)/clickhouse-connectivity-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";
import CustomPostHogProvider from "@/components/(playground)/posthog";
import NavigationEvents from "@/components/common/navigation-events";
import AppInit from "@/components/common/app-init";

export default async function PlaygroundLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

	return (
		<CustomPostHogProvider telemetryEnabled={telemetryEnabled}>
			<TooltipProvider>
				<div className="flex h-screen w-full pl-[56px] overflow-hidden">
					<Sidebar />
					<div className="flex flex-col grow w-full">
						<Header />
						<main className="flex flex-col grow flex-1 items-start p-4 sm:px-6 overflow-hidden">
							{/* <div className="fixed inset-0 w-full h-full bg-cover bg-center bg-no-repeat z-[-1]" style={{
								backgroundImage: "linear-gradient(344deg, #f89b29 5%, rgba(255,255,255,0) 72%)"
							}} /> */}
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
