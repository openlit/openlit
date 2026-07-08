import { alertingUnavailable } from "@/lib/rbac/routes/api/alerts/unavailable";
import * as alertsRoute from "@/lib/rbac/routes/api/alerts/route";
import * as alertByIdRoute from "@/lib/rbac/routes/api/alerts/[id]/route";
import * as alertTestRoute from "@/lib/rbac/routes/api/alerts/[id]/test/route";
import * as alertEventsRoute from "@/lib/rbac/routes/api/alerts/events/route";
import * as alertSpecRoute from "@/lib/rbac/routes/api/alerts/spec/route";
import * as alertDestinationsRoute from "@/lib/rbac/routes/api/alert-destinations/route";
import * as alertDestinationByIdRoute from "@/lib/rbac/routes/api/alert-destinations/[id]/route";
import * as alertDestinationTestRoute from "@/lib/rbac/routes/api/alert-destinations/[id]/test/route";
import * as alertProvidersRoute from "@/lib/rbac/routes/api/alert-providers/route";

describe("CE alert route handlers (no entitlement/RBAC available in this edition)", () => {
	it.each([
		["alerts/route.ts GET", alertsRoute.GET],
		["alerts/route.ts POST", alertsRoute.POST],
		["alerts/[id]/route.ts GET", alertByIdRoute.GET],
		["alerts/[id]/route.ts PATCH", alertByIdRoute.PATCH],
		["alerts/[id]/route.ts DELETE", alertByIdRoute.DELETE],
		["alerts/[id]/test/route.ts POST", alertTestRoute.POST],
		["alerts/events/route.ts GET", alertEventsRoute.GET],
		["alerts/spec/route.ts GET", alertSpecRoute.GET],
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
