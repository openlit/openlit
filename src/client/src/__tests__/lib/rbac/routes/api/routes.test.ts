import { alertingUnavailable } from "@/lib/rbac/routes/api/alerts/unavailable";
import * as alertTestRoute from "@/lib/rbac/routes/api/alerts/[id]/test/route";
import * as alertEventsRoute from "@/lib/rbac/routes/api/alerts/events/route";
import * as alertSpecRoute from "@/lib/rbac/routes/api/alerts/spec/route";
import * as alertConditionValuesRoute from "@/lib/rbac/routes/api/alerts/condition-values/route";
import * as alertDestinationsRoute from "@/lib/rbac/routes/api/alert-destinations/route";
import * as alertDestinationByIdRoute from "@/lib/rbac/routes/api/alert-destinations/[id]/route";
import * as alertDestinationTestRoute from "@/lib/rbac/routes/api/alert-destinations/[id]/test/route";
import * as alertProvidersRoute from "@/lib/rbac/routes/api/alert-providers/route";

// Threshold alerts (/api/alerts, /api/alerts/[id]) are available in CE and
// covered in __tests__/lib/platform/alerts. Event alerts, notification
// destinations, and providers stay enterprise-only.
describe("CE event alert and destination routes (enterprise-only)", () => {
	it.each([
		["alerts/[id]/test/route.ts POST", alertTestRoute.POST],
		["alerts/events/route.ts GET", alertEventsRoute.GET],
		["alerts/spec/route.ts GET", alertSpecRoute.GET],
		["alerts/condition-values/route.ts GET", alertConditionValuesRoute.GET],
		["alert-destinations/route.ts GET", alertDestinationsRoute.GET],
		["alert-destinations/route.ts POST", alertDestinationsRoute.POST],
		["alert-destinations/[id]/route.ts GET", alertDestinationByIdRoute.GET],
		["alert-destinations/[id]/route.ts PATCH", alertDestinationByIdRoute.PATCH],
		["alert-destinations/[id]/route.ts DELETE", alertDestinationByIdRoute.DELETE],
		["alert-destinations/[id]/test/route.ts POST", alertDestinationTestRoute.POST],
		["alert-providers/route.ts GET", alertProvidersRoute.GET],
	])("%s is wired to the alertingUnavailable fallback", (_name, handler) => {
		expect(handler).toBe(alertingUnavailable);
	});
});
