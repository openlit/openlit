import { NextRequest, NextResponse } from "next/server";
import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getPricingExport } from "@/lib/platform/pricing/export";

/**
 * GET /api/pricing/export/[dbConfigId]
 *
 * Public (no auth required) endpoint that returns all model pricing in the
 * OpenLIT SDK `pricing_json` format. The URL is unique per database config
 * and can be shared / used in SDK init:
 *
 *   openlit.init(pricing_json="http://localhost:3000/api/pricing/export/<dbConfigId>")
 *
 * withAudit/withCurrentOrganisationPermission are no-op pass-throughs here;
 * enterprise editions resolve them to real permission + audit checks.
 */
async function GETHandler(
	_request: NextRequest,
	{ params }: { params: { dbConfigId: string } }
) {
	const { dbConfigId } = params;
	const result = await getPricingExport(dbConfigId);

	if ("error" in result) {
		return NextResponse.json({ error: result.error }, { status: result.status });
	}

	return NextResponse.json(result.data, {
		headers: {
			"Cache-Control": "public, max-age=300",
		},
	});
}

export const GET = withAudit(
	withCurrentOrganisationPermission("pricing:export", GETHandler)
);
