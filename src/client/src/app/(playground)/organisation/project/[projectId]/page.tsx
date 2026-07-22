import OrganisationProjectPage from "@/components/(playground)/organisation/project-page";

export default async function ProjectRoutePage(
    props: {
        params: Promise<{ projectId: string }>;
    }
) {
    const params = await props.params;
    return <OrganisationProjectPage projectId={params.projectId} />;
}
