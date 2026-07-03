import { Suspense } from "react";
import ClickhouseConnectivityWrapper from "@/components/(playground)/clickhouse-connectivity-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";
import CustomPostHogProvider from "@/components/(playground)/posthog";
import NavigationEvents from "@/components/common/navigation-events";
import AppInit from "@/components/common/app-init";
import { PortalProvider } from "@/components/(playground)/header-portal";
import ChatFloatingButton from "@/components/(playground)/chat/chat-floating-button";
import PlaygroundShell from "@/components/(playground)/playground-shell";
import {
	EnterpriseFeatureAccessProvider,
	EnterpriseFeatureRouteGate,
} from "@/components/enterprise-feature-access-provider";
import { getEnterpriseFeatureAccessSnapshot } from "@/lib/enterprise-feature-access";

export default async function PlaygroundLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";
	const enterpriseFeatureAccess = await getEnterpriseFeatureAccessSnapshot();

	return (
		<CustomPostHogProvider telemetryEnabled={telemetryEnabled}>
			<TooltipProvider>
				<EnterpriseFeatureAccessProvider snapshot={enterpriseFeatureAccess}>
					<PortalProvider>
						<PlaygroundShell>
							<ClickhouseConnectivityWrapper>
								<EnterpriseFeatureRouteGate>
									{children}
								</EnterpriseFeatureRouteGate>
							</ClickhouseConnectivityWrapper>
						</PlaygroundShell>
						<ChatFloatingButton />
					</PortalProvider>
				</EnterpriseFeatureAccessProvider>
			</TooltipProvider>
			<Suspense fallback={null}>
				<NavigationEvents />
				<AppInit />
			</Suspense>
		</CustomPostHogProvider>
	);
}
