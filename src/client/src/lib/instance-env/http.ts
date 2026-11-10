import { disabledFeature } from "@/features/disabled-feature";
import { withInstanceAdmin } from "@/lib/instance-admin/route";

const FEATURE_ID = "enterprise.instance-admin";

// Instance auth settings are an enterprise feature. The fallback still checks
// the instance admin first, so other users never learn more than a 403.
async function upgradeRequired(_request: Request, _context: unknown) {
	return disabledFeature(FEATURE_ID).upgradeRequired();
}

export const GET = withInstanceAdmin(upgradeRequired);
export const PATCH = withInstanceAdmin(upgradeRequired);
export const VERIFY = withInstanceAdmin(upgradeRequired);
