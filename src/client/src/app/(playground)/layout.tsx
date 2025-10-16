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
				<div className="flex h-screen w-full gap-4 overflow-hidden p-2">
					<Sidebar />
					<div className="flex flex-col grow w-full">
						<Header />
						<main className="flex flex-col grow flex-1 items-start p-0 overflow-hidden">
							{/* <div className="fixed inset-0 w-full h-full z-[-2]
								[background-size:40px_40px]
[background-image:linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)]
          dark:[background-image:linear-gradient(to_right,#262626_1px,transparent_1px),linear-gradient(to_bottom,#262626_1px,transparent_1px)]
							" />
							<div className="pointer-events-none fixed w-full h-full inset-0 flex items-center justify-center bg-white [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)] dark:bg-black  z-[-1]"></div> */}
      
							<ClickhouseConnectivityWrapper>
								{children}
							</ClickhouseConnectivityWrapper>
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
