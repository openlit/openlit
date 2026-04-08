import { getCurrentUser } from "@/lib/session";
import { updateUserProfile } from "@/lib/user";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import { validateProfileName } from "@/utils/validation";

function stripPasswordFromUser(user: any) {
	if (!user) return user;
	const { password, ...rest } = user;
	return rest;
}

export async function GET() {
	const user: any = await getCurrentUser();

	if (!user)
		return Response.json("No user loggedin!", {
			status: 401,
		});

	return Response.json(stripPasswordFromUser(user));
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();
	const formData = await request.json();

	// Validate name if provided
	if (formData.name) {
		const nameValidation = validateProfileName(formData.name);
		if (!nameValidation.valid) {
			return Response.json(nameValidation.error, { status: 400 });
		}
	}

	const formObject = {
		currentPassword: formData.currentPassword,
		newPassword: formData.newPassword,
		name: formData.name,
	};

	const [err, res]: any = await asaw(updateUserProfile(formObject));

	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.USER_PROFILE_UPDATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, {
			status: 400,
		});
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.USER_PROFILE_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
