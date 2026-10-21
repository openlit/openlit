import { withRouteAccess } from "@/lib/access/route-access";
import { thresholdAlertOverviewHandler } from "@/lib/platform/alerts/threshold-handlers";

export const GET = withRouteAccess("alerts.read", thresholdAlertOverviewHandler);
