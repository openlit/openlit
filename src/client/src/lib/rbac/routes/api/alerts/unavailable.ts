export function alertingUnavailable() {
	return Response.json(
		{ error: "Alerting is not available in this edition." },
		{ status: 402 }
	);
}
