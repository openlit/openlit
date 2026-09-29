import ProjectConnectorsPage from "@/components/(playground)/organisation/project-connectors-page";

export default function ProjectConnectorsRoutePage({
	params,
}: {
	params: { projectId: string };
}) {
	return <ProjectConnectorsPage projectId={params.projectId} />;
}
