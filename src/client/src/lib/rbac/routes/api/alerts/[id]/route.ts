import { withAudit } from "@/lib/audit/route";
import { withRouteAccess } from "@/lib/access/route-access";
import {
	deleteThresholdAlertHandler,
	getThresholdAlertHandler,
	updateThresholdAlertHandler,
} from "@/lib/platform/alerts/threshold-handlers";

export const GET = withRouteAccess("alerts.read", getThresholdAlertHandler);
export const PATCH = withAudit(withRouteAccess("alerts.update", updateThresholdAlertHandler));
export const DELETE = withAudit(withRouteAccess("alerts.delete", deleteThresholdAlertHandler));
