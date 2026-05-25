/**
 * Stub for the v2 GitHub App install handshake.
 *
 * v1 ships the data model (Prisma `GitHubInstallation`, ClickHouse
 * `openlit_vcs_*`) and stamps `vcs.repository.url.full` /
 * `vcs.ref.head.revision` on every span, but does not yet expose the
 * install/setup/webhook flow. We return 501 so the UI's "Connect
 * GitHub" call has a deterministic shape today and lights up the
 * moment v2 lands without any client changes.
 */

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(
		{
			error: "not_implemented",
			message:
				"GitHub App install flow ships in v2. The data model and span stamping are in place; the install/setup/webhook handlers will be enabled when the App is published.",
		},
		{ status: 501 }
	);
}

export async function POST() {
	return Response.json(
		{
			error: "not_implemented",
			message:
				"GitHub App install flow ships in v2. The data model and span stamping are in place; the install/setup/webhook handlers will be enabled when the App is published.",
		},
		{ status: 501 }
	);
}
