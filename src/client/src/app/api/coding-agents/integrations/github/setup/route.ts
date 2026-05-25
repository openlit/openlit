/**
 * Stub for the v2 GitHub App post-install setup callback. See
 * `install/route.ts` for the full v1↔v2 contract.
 */

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(
		{
			error: "not_implemented",
			message: "GitHub App setup callback ships in v2.",
		},
		{ status: 501 }
	);
}
