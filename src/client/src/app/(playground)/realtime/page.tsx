import { redirect } from "next/navigation";

// Realtime findings live under Alerts.
export default function RealtimePage() {
	redirect("/alerts");
}
