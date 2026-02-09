import { inviteUserToOrganisation } from "@/lib/organisation";
import asaw from "@/utils/asaw";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const formData = await request.json();
	const { emails } = formData;

	if (!emails || !Array.isArray(emails) || emails.length === 0) {
		return Response.json("At least one email is required", {
			status: 400,
		});
	}

	const results = await Promise.all(
		emails.map(async (email: string) => {
			const [err, res] = await asaw(inviteUserToOrganisation(id, email));
			return {
				email,
				error: err ? String(err).replace(/^Error:\s*/, "") : null,
				result: res,
			};
		})
	);

	const hasErrors = results.some((r) => r.error);
	if (hasErrors) {
		return Response.json(results, {
			status: 207, // Multi-status
		});
	}

	return Response.json(results);
}
