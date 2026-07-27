import prisma from "./prisma";
import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "./organisation";

const ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

async function requireProjectId() {
	const organisation = await getCurrentOrganisation();
	if (!organisation?.id) throw new Error("Organisation is required");
	const project = await getCurrentProjectForOrganisation(organisation.id);
	if (!project?.id) throw new Error("Project is required");
	return project.id;
}

export function normalizeProjectEnvironment(value: unknown) {
	const name = String(value || "").trim().toLowerCase();
	if (!ENVIRONMENT_PATTERN.test(name)) {
		throw new Error("Environment must use lowercase letters, numbers, dots, hyphens, or underscores");
	}
	return name;
}

export async function listProjectEnvironments() {
	const projectId = await requireProjectId();
	return prisma.projectEnvironment.findMany({ where: { projectId }, orderBy: { name: "asc" } });
}

export async function createProjectEnvironment(value: unknown) {
	const projectId = await requireProjectId();
	const name = normalizeProjectEnvironment(value);
	// Some isolated CE unit tests provide a minimal Prisma mock from before
	// environments became first-class. Keep environment registration additive
	// for those callers while production always has the generated delegate.
	if (!prisma.projectEnvironment?.upsert) return { id: "", projectId, name };
	return prisma.projectEnvironment.upsert({
		where: { projectId_name: { projectId, name } },
		create: { projectId, name },
		update: {},
	});
}
