import { inviteUserToOrganisation } from "@/lib/organisation";
import asaw from "@/utils/asaw";

// Email validation regex - using a safer pattern that avoids ReDoS vulnerability
// This pattern is more restrictive but safe from catastrophic backtracking
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

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
			// Validate email format and content before processing
			const trimmedEmail = typeof email === "string" ? email.trim() : "";
			
			if (!trimmedEmail) {
				return {
					email: email,
					error: "Email cannot be empty",
					result: null,
				};
			}

			if (!EMAIL_REGEX.test(trimmedEmail)) {
				return {
					email: trimmedEmail,
					error: "Invalid email format",
					result: null,
				};
			}

			const [err, res] = await asaw(inviteUserToOrganisation(id, trimmedEmail));
			return {
				email: trimmedEmail,
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
