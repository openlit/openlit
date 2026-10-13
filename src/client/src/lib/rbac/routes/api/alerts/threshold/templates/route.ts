import { withRouteAccess } from "@/lib/access/route-access";
import { thresholdAlertTemplatesHandler } from "@/lib/platform/alerts/threshold-handlers";

export const GET = withRouteAccess("alerts.read", thresholdAlertTemplatesHandler);
