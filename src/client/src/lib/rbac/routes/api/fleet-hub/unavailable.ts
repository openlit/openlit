import getMessage from "@/constants/messages";

export function fleetHubUnavailable() {
	return Response.json(
		{ error: getMessage().FLEET_HUB_UNAVAILABLE },
		{ status: 402 }
	);
}
