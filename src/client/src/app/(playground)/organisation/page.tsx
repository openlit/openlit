import { redirect } from "next/navigation";
import OrganisationPage from "@/components/(playground)/organisation/organisation-page";

export default function OrganisationRoutePage({
	searchParams,
}: {
	searchParams: { tab?: string };
}) {
	if (searchParams.tab === "projects") {
		redirect("/organisation/projects");
	}

	return <OrganisationPage />;
}
