import { redirect } from "next/navigation";

export default function ObservabilityRedirect({
	searchParams,
}: {
	searchParams: Record<string, string | string[] | undefined>;
}) {
	const params = new URLSearchParams();
	Object.entries(searchParams).forEach(([key, value]) => {
		if (Array.isArray(value)) {
			value.forEach((item) => params.append(key, item));
			return;
		}
		if (value) params.set(key, value);
	});
	redirect(`/telemetry${params.toString() ? `?${params.toString()}` : ""}`);
}
