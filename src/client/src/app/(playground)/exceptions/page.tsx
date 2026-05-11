import { redirect } from "next/navigation";

export default function Page() {
	redirect("/observability?tab=exceptions");
}
