import { redirect } from "next/navigation";
import AdminShell from "@/components/(admin)/admin-shell";
import CustomPostHogProvider from "@/components/(playground)/posthog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_LOGGED_IN_ROUTE, INSTANCE_ADMIN_ROUTE_PREFIX } from "@/constants/route";
import { isInstanceAdminUser } from "@/lib/instance-admin";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// Instance admin pages sit outside organisation and project scope. Middleware
// filters on the session claim; this re-checks the database on every render.
export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const user = await getCurrentUser();
	if (!user) {
		redirect(`/login?callbackUrl=${encodeURIComponent(INSTANCE_ADMIN_ROUTE_PREFIX)}`);
	}
	if (!(await isInstanceAdminUser(user.id))) {
		redirect(DEFAULT_LOGGED_IN_ROUTE);
	}

	const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

	return (
		<CustomPostHogProvider telemetryEnabled={telemetryEnabled}>
			<TooltipProvider>
				<AdminShell adminEmail={user.email}>{children}</AdminShell>
			</TooltipProvider>
		</CustomPostHogProvider>
	);
}
