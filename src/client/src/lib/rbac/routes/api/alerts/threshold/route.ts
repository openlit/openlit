import { withAudit } from "@/lib/audit/route";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	createThresholdAlertHandler,
	listThresholdAlertsHandler,
} from "@/lib/platform/alerts/threshold-handlers";

export const GET = withRouteAccess("alerts.read", listThresholdAlertsHandler);
export const POST = withAudit(withRouteAccess("alerts.create", createThresholdAlertHandler));
