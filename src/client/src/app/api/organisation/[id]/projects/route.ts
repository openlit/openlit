import {
	createOrganisationProject,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

async function readJson(request: Request) {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

export async function GET(
	_request: Request,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId: params.id,
				userId: user.id,
			},
		},
		select: { id: true },
	});

	if (!membership) return Response.json("Organisation not found", { status: 404 });

	const [currentProjectErr, currentProject] = await asaw(
		getCurrentProjectForOrganisation(params.id)
	);
	if (currentProjectErr) return Response.json(currentProjectErr, { status: 400 });

	const projects = await prisma.project.findMany({
		where: { organisationId: params.id },
		orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
	});

	return Response.json(
		projects.map((project) => ({
			...project,
			isCurrent: project.id === currentProject?.id,
		}))
	);
}

export async function POST(
	request: Request,
	{ params }: { params: { id: string } }
) {
	const formData = await readJson(request);
	const name = formData?.name?.trim();

	if (!name) return Response.json("Project name is required", { status: 400 });
	if (name.length > 120) {
		return Response.json("Project name must be 120 characters or less", {
			status: 400,
		});
	}

	const [err, project] = await asaw(createOrganisationProject(params.id, name));
	if (err) return Response.json(err, { status: 400 });

	return Response.json(project);
}
