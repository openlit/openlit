import OrganisationProjectPage from "@/components/(playground)/organisation/project-page";

export default function ProjectRoutePage({
	params,
}: {
	params: { projectId: string };
}) {
	return <OrganisationProjectPage projectId={params.projectId} />;
}
