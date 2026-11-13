#!/usr/bin/env node
/**
 * Seeds a throwaway OpenLIT database with mock data for PR scale testing.
 *
 * Creates users, organisations, memberships, projects, environments, database
 * configs, ClickHouse connectors, invitations, and (when the schema has the
 * table) instance admins, so routes can be exercised at realistic volume.
 *
 * Usage (from src/client):
 *   SQLITE_DATABASE_URL="file:/tmp/openlit-scale.db" npx prisma migrate deploy
 *   SQLITE_DATABASE_URL="file:/tmp/openlit-scale.db" node scripts/pr-validation/seed-scale-data.js --throwaway
 *
 * Sizes (environment variables, defaults in brackets):
 *   SCALE_USERS [2000]  SCALE_ORGS [50]  SCALE_MEMBERS_PER_ORG [40]
 *   SCALE_PROJECTS_PER_ORG [20]  SCALE_ENVIRONMENTS_PER_PROJECT [3]
 *   SCALE_INVITES_PER_ORG [10]  SCALE_INSTANCE_ADMINS [5]
 *
 * Every mock user signs in with the password `openlituser`, and some are
 * instance admins, so this refuses to run unless the database is a SQLite file
 * in the system temp directory holding only the seeded account and mock users.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

// bcrypt hash of "openlituser", the same hash prisma/seed.js uses.
const PASSWORD_HASH = "$2a$10$gh6Odw7fhLRrE1A1OxaHfeWOWKiZEEQpkOAhhCQ.RHx8VWOngwlHO";
const ENVIRONMENTS = ["production", "staging", "development", "qa", "sandbox"];
const BATCH = 500;
const SEEDED_ACCOUNT = "user@openlit.io";
const MOCK_EMAIL_SUFFIX = "@scale.test";

function size(name, fallback) {
	const value = Number.parseInt(process.env[name] || "", 10);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const config = {
	users: size("SCALE_USERS", 2000),
	orgs: size("SCALE_ORGS", 50),
	membersPerOrg: size("SCALE_MEMBERS_PER_ORG", 40),
	projectsPerOrg: size("SCALE_PROJECTS_PER_ORG", 20),
	environmentsPerProject: Math.min(size("SCALE_ENVIRONMENTS_PER_PROJECT", 3), ENVIRONMENTS.length),
	invitesPerOrg: size("SCALE_INVITES_PER_ORG", 10),
	instanceAdmins: size("SCALE_INSTANCE_ADMINS", 5),
};

async function insertInBatches(model, rows) {
	for (let index = 0; index < rows.length; index += BATCH) {
		await model.createMany({ data: rows.slice(index, index + BATCH) });
	}
	return rows.length;
}

// Symlinks are resolved, so a link in the temp directory can't reach a real database.
function isTemporaryDatabase(databaseUrl) {
	const [, file] = /^file:([^?]+)/.exec(databaseUrl) || [];
	if (!file || !path.isAbsolute(file) || !fs.existsSync(file)) return false;
	const database = fs.realpathSync(file);
	return ["/tmp", os.tmpdir()]
		.filter((root) => fs.existsSync(root))
		.some((root) => database.startsWith(fs.realpathSync(root) + path.sep));
}

function refuse(reason) {
	console.error(`Refusing to run: ${reason}`);
	process.exitCode = 1;
}

async function main() {
	const databaseUrl = process.env.SQLITE_DATABASE_URL || "";
	if (!process.argv.includes("--throwaway")) {
		refuse("pass --throwaway.");
		return;
	}
	if (!isTemporaryDatabase(databaseUrl)) {
		refuse("point SQLITE_DATABASE_URL at a migrated SQLite file in the system temp directory.");
		return;
	}

	const prisma = new PrismaClient();
	const started = Date.now();
	const run = Date.now().toString(36);

	try {
		const otherAccounts = await prisma.user.count({
			where: {
				email: { not: SEEDED_ACCOUNT },
				NOT: { email: { endsWith: MOCK_EMAIL_SUFFIX } },
			},
		});
		if (otherAccounts > 0) {
			refuse(`the database has ${otherAccounts} account(s) that aren't seeded or mock users.`);
			return;
		}

		console.log(`Seeding mock data into ${databaseUrl}`, config);

		// The earliest account stays the primary instance admin, so mock users
		// are created after any account that already exists.
		const users = Array.from({ length: config.users }, (_, index) => ({
			id: `scale-user-${run}-${index}`,
			email: `scale-${run}-${index}${MOCK_EMAIL_SUFFIX}`,
			name: `Scale User ${index}`,
			password: PASSWORD_HASH,
			hasCompletedOnboarding: true,
		}));
		await insertInBatches(prisma.user, users);

		const orgs = [];
		const memberships = [];
		const projects = [];
		const projectUsers = [];
		const environments = [];
		const databaseConfigs = [];
		const databaseConfigUsers = [];
		const connectors = [];
		const invites = [];

		for (let o = 0; o < config.orgs; o += 1) {
			const orgId = `scale-org-${run}-${o}`;
			const owner = users[o % Math.max(users.length, 1)];
			if (!owner) break;
			orgs.push({ id: orgId, name: `Scale Org ${o}`, slug: `scale-${run}-${o}`, createdByUserId: owner.id });

			const memberIds = new Set([owner.id]);
			for (let m = 1; memberIds.size < Math.min(config.membersPerOrg, users.length); m += 1) {
				memberIds.add(users[(o * config.membersPerOrg + m) % users.length].id);
			}
			const orgMembers = Array.from(memberIds).map((userId, index) => ({
				id: `scale-ou-${run}-${o}-${index}`,
				organisationId: orgId,
				userId,
				role: index === 0 ? "owner" : index % 10 === 0 ? "admin" : "member",
				isCurrent: true,
			}));
			memberships.push(...orgMembers);

			for (let p = 0; p < config.projectsPerOrg; p += 1) {
				const projectId = `scale-project-${run}-${o}-${p}`;
				projects.push({ id: projectId, organisationId: orgId, name: `Project ${p}`, slug: `project-${p}`, isDefault: p === 0 });
				for (const member of orgMembers.slice(0, 5)) {
					projectUsers.push({ projectId, organisationUserId: member.id, userId: member.userId });
				}
				for (const environment of ENVIRONMENTS.slice(0, config.environmentsPerProject)) {
					environments.push({ projectId, name: environment });
					const configId = `scale-db-${run}-${o}-${p}-${environment}`;
					databaseConfigs.push({
						id: configId,
						name: `ClickHouse ${environment}`,
						environment,
						username: "default",
						password: "",
						host: "127.0.0.1",
						port: "8123",
						database: `scale_${o}_${p}`,
						createdByUserId: owner.id,
						projectId,
					});
					databaseConfigUsers.push({
						databaseConfigId: configId,
						userId: owner.id,
						isCurrent: environment === "production" && p === 0,
						canEdit: true,
						canDelete: true,
						canShare: true,
					});
					connectors.push({
						id: `database:${configId}`,
						category: "datasource",
						type: "clickhouse",
						name: `ClickHouse ${environment}`,
						environment,
						projectId,
						settings: JSON.stringify({ host: "127.0.0.1", port: "8123", database: `scale_${o}_${p}` }),
						status: "active",
					});
				}
			}

			for (let i = 0; i < config.invitesPerOrg; i += 1) {
				invites.push({ organisationId: orgId, email: `invite-${run}-${o}-${i}${MOCK_EMAIL_SUFFIX}`, invitedByUserId: owner.id });
			}
		}

		const counts = {
			users: users.length,
			organisations: await insertInBatches(prisma.organisation, orgs),
			memberships: await insertInBatches(prisma.organisationUser, memberships),
			projects: await insertInBatches(prisma.project, projects),
			projectMembers: await insertInBatches(prisma.projectUser, projectUsers),
			environments: await insertInBatches(prisma.projectEnvironment, environments),
			databaseConfigs: await insertInBatches(prisma.databaseConfig, databaseConfigs),
			databaseConfigUsers: await insertInBatches(prisma.databaseConfigUser, databaseConfigUsers),
			connectors: prisma.connectorInstance ? await insertInBatches(prisma.connectorInstance, connectors) : 0,
			invitations: prisma.organisationInvitedUser
				? await insertInBatches(prisma.organisationInvitedUser, invites)
				: 0,
			instanceAdmins: 0,
		};

		// Enterprise schemas store additional instance admins.
		if (prisma.instanceAdmin) {
			counts.instanceAdmins = await insertInBatches(
				prisma.instanceAdmin,
				users.slice(0, config.instanceAdmins).map((user) => ({ userId: user.id }))
			);
		}

		console.log("Seeded", counts, `in ${((Date.now() - started) / 1000).toFixed(1)}s`);
		console.log(`Sign in as ${users[0]?.email ?? "(no users)"} with password openlituser.`);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
