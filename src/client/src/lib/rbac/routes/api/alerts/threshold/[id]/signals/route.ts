import { withRouteAccess } from "@/lib/access/route-access";
import { thresholdAlertSignalsHandler } from "@/lib/platform/alerts/threshold-handlers";

export const GET = withRouteAccess("alerts.read", thresholdAlertSignalsHandler);
