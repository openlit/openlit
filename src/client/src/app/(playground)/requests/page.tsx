import { redirect } from "next/navigation";

export default function Page() {
	redirect("/telemetry?tab=traces");
	return null;
}
