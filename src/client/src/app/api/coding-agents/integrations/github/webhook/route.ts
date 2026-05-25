/**
 * Stub for the v2 GitHub webhook receiver. The v2 handler will:
 *   - verify the X-Hub-Signature-256 header
 *   - INSERT into openlit_vcs_commits / openlit_vcs_pull_requests
 *   - kick the AI-authorship detector on push events
 *
 * v1 returns 501 so misconfigured webhooks fail loudly during setup
 * rather than silently 200ing.
 */

export const dynamic = "force-dynamic";

export async function POST() {
	return Response.json(
		{
			error: "not_implemented",
			message: "GitHub webhook receiver ships in v2.",
		},
		{ status: 501 }
	);
}
