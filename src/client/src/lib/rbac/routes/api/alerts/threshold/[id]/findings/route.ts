import { withRouteAccess } from "@/lib/access/route-access";
import { thresholdAlertFindingsHandler } from "@/lib/platform/alerts/threshold-handlers";

export const GET = withRouteAccess("alerts.read", thresholdAlertFindingsHandler);
