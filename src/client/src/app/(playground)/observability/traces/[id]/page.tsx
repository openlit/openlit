import { redirect } from "next/navigation";

export default function TraceRedirect({
	params,
	searchParams,
}: {
	params: { id: string };
	searchParams: Record<string, string | string[] | undefined>;
}) {
	const query = new URLSearchParams();
	Object.entries(searchParams).forEach(([key, value]) => {
		if (Array.isArray(value)) {
			value.forEach((item) => query.append(key, item));
			return;
		}
		if (value) query.set(key, value);
	});
	redirect(`/telemetry/traces/${params.id}${query.toString() ? `?${query.toString()}` : ""}`);
}
