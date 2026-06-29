import asaw from "@/utils/asaw";
import prisma from "./prisma";
import { getCurrentUser } from "./session";
import { DatabaseConfig, DatabaseConfigInvitedUser } from "@prisma/client";
import migrations from "@/clickhouse/migrations";
import getMessage from "@/constants/messages";
import { throwIfError } from "@/utils/error";
import { consoleLog } from "@/utils/log";
import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "./organisation";
import { validateDatabaseHost } from "@/utils/validation";

export const getDBConfigByUser = async (currentOnly?: boolean) => {
	const user = await getCurrentUser();

	if (!user) throw new Error(getMessage().UNAUTHORIZED_USER);

	// Get current organisation
	const currentOrg = await getCurrentOrganisation();
	const currentProject = currentOrg?.id
		? await getCurrentProjectForOrganisation(currentOrg.id)
		: null;

	// Auto-migrate orphaned configs: If user has a current organisation, move any orphaned configs
	// they have access to into its current project. This handles edge cases where migration didn't run
	// or new orphaned configs were created.
	if (currentOrg?.id) {
		const userOrphanedLinks = await prisma.databaseConfigUser.findMany({
			where: {
				userId: user.id,
				databaseConfig: {
					projectId: null,
				},
			},
			select: { databaseConfigId: true },
		});

		if (userOrphanedLinks.length > 0) {
			const orphanedConfigIds = userOrphanedLinks.map(
				(link) => link.databaseConfigId
			);

			await prisma.databaseConfig.updateMany({
				where: { id: { in: orphanedConfigIds } },
				data: { projectId: currentProject?.id },
			});

			consoleLog(
				`Auto-migrated ${orphanedConfigIds.length} orphaned configs for user ${user.id} to org ${currentOrg.id}`
			);
		}
	}

	if (currentOnly) {
		const dbConfig = await prisma.databaseConfigUser.findFirst({
			where: {
				userId: user.id,
				isCurrent: true,
				// Always filter by current project to maintain data isolation
				// If no current organisation, only return orphaned configs (projectId: null)
				databaseConfig: {
					projectId: currentProject?.id ?? null,
				},
			},
			select: {
				databaseConfig: true,
			},
		});

		return dbConfig?.databaseConfig;
	}

	const dbUserConfigs = await prisma.databaseConfigUser.findMany({
		where: {
			userId: user.id,
			// Always filter by current project to maintain data isolation
			// If no current organisation, only return orphaned configs (projectId: null)
			databaseConfig: {
				projectId: currentProject?.id ?? null,
			},
		},
		select: {
			databaseConfigId: true,
			isCurrent: true,
			databaseConfig: true,
			canEdit: true,
			canDelete: true,
			canShare: true,
		},
		orderBy: {
			databaseConfig: {
				createdAt: "asc",
			},
		},
	});

	const dbConfigs = dbUserConfigs.map((dbConfig) => ({
		...dbConfig.databaseConfig,
		permissions: {
			canEdit: dbConfig.canEdit,
			canDelete: dbConfig.canDelete,
			canShare: dbConfig.canShare,
		},
	}));
	const currentConfig = dbUserConfigs.find((dbConfig) => dbConfig.isCurrent);
	return dbConfigs.map((dbConfig) => ({
		...dbConfig,
		isCurrent: currentConfig?.databaseConfigId === dbConfig?.id,
	}));
};

export const getDBConfigById = async ({ id }: { id: string }) => {
	return await prisma.databaseConfig.findUnique({
		where: {
			id,
		},
	});
};

export const getFirstDBConfig = async (): Promise<DatabaseConfig | null> => {
	return await prisma.databaseConfig.findFirst({
		orderBy: { createdAt: "asc" },
	});
};

export const upsertDBConfig = async (
	dbConfig: Partial<DatabaseConfig>,
	id?: string
) => {
	if (!dbConfig.name) throw new Error("No name provided");
	if (!dbConfig.username) throw new Error("No username provided");
	if (!dbConfig.host) throw new Error("No host provided");
	if (!dbConfig.port) throw new Error("No port provided");
	if (!dbConfig.database) throw new Error("No database provided");

	const hostValidation = validateDatabaseHost(dbConfig.host);
	if (!hostValidation.valid) {
		throw new Error(hostValidation.error || "Invalid host");
	}

	if (typeof dbConfig.port !== "string") {
		dbConfig.port = String(dbConfig.port);
	}

	const user = await getCurrentUser();

	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Get current organisation
	const currentOrg = await getCurrentOrganisation();
	const currentProject = currentOrg?.id
		? await getCurrentProjectForOrganisation(currentOrg.id)
		: null;

	const existingDBName = await prisma.databaseConfig.findFirst({
		where: {
			name: dbConfig.name,
			projectId: currentProject?.id || null,
			NOT: {
				id,
			},
		},
	});

	if (existingDBName?.id) throw new Error("DB config Name already exists");

	if (id) {
		await checkPermissionForDbAction(user!.id, id, "EDIT");
	}

	let createddbConfig: DatabaseConfig;
	
	// When updating by id, use upsert with id
	if (id) {
		const whereObject = { id };
		const [err, result] = await asaw(
			prisma.databaseConfig.upsert({
				where: whereObject,
				create: {
					...(dbConfig as any),
					createdByUserId: user!.id,
					projectId: currentProject?.id,
				},
				update: {
					...dbConfig,
				},
			})
		);
		if (err) throw err;
		createddbConfig = result;
	}
	// When creating with a project, use compound unique constraint
	else if (currentProject?.id) {
		const whereObject = {
			name_projectId: {
				name: dbConfig.name,
				projectId: currentProject.id,
			},
		};
		const [err, result] = await asaw(
			prisma.databaseConfig.upsert({
				where: whereObject,
				create: {
					...(dbConfig as any),
					createdByUserId: user!.id,
					projectId: currentProject.id,
				},
				update: {
					...dbConfig,
				},
			})
		);
		if (err) throw err;
		createddbConfig = result;
	}
	// When creating without a project (null projectId),
	// Prisma doesn't support null in compound unique constraints, 
	// so we use findFirst + create/update pattern
	else {
		const existing = await prisma.databaseConfig.findFirst({
			where: {
				name: dbConfig.name,
				projectId: null,
			},
		});
		
		if (existing) {
			// Update existing config
			createddbConfig = await prisma.databaseConfig.update({
				where: { id: existing.id },
				data: {
					...dbConfig,
				},
			});
		} else {
			// Create new config
			createddbConfig = await prisma.databaseConfig.create({
				data: {
					...(dbConfig as any),
					createdByUserId: user!.id,
					projectId: null,
				},
			});
		}
	}

	if (!id) {
		await addDatabaseConfigUserEntry(user!.id, createddbConfig.id, {
			canEdit: true,
			canDelete: true,
			canShare: true,
		});
		migrations(createddbConfig.id);
	}

	return `${id ? "Updated" : "Added"} db details successfully`;
};

export async function deleteDBConfig(id: string) {
	const user = await getCurrentUser();

	if (!user) throw new Error(getMessage().UNAUTHORIZED_USER);

	await checkPermissionForDbAction(user.id, id, "DELETE");

	await prisma.databaseConfigUser.delete({
		where: {
			databaseConfigId_userId: {
				userId: user.id,
				databaseConfigId: id,
			},
		},
	});

	await prisma.databaseConfig.delete({
		where: {
			id,
		},
	});

	return "Deleted successfully!";
}

export async function setCurrentDBConfig(id: string) {
	const user = await getCurrentUser();

	if (!user) throw new Error(getMessage().UNAUTHORIZED_USER);

	const currentOrg = await getCurrentOrganisation();
	const currentProject = currentOrg?.id
		? await getCurrentProjectForOrganisation(currentOrg.id)
		: null;
	const targetConfig = await prisma.databaseConfig.findFirst({
		where: {
			id,
			projectId: currentProject?.id ?? null,
		},
		select: { id: true },
	});

	if (!targetConfig) {
		throw new Error(getMessage().DB_CONFIG_NOT_IN_CURRENT_PROJECT);
	}

	const currentConfig = await getDBConfigByUser(true);

	if ((currentConfig as DatabaseConfig)?.id) {
		await prisma.databaseConfigUser.update({
			where: {
				databaseConfigId_userId: {
					userId: user.id,
					databaseConfigId: (currentConfig as DatabaseConfig).id,
				},
			},
			data: {
				isCurrent: false,
			},
		});
	}

	await prisma.databaseConfigUser.update({
		where: {
			databaseConfigId_userId: {
				userId: user.id,
				databaseConfigId: id,
			},
		},
		data: {
			isCurrent: true,
		},
	});

	return getMessage().CURRENT_DB_CONFIG_SET_SUCCESS;
}

export async function shareDBConfig({
	shareArray,
	id,
}: {
	id: string;
	shareArray: {
		email: string;
		permissions?: {
			canDelete: boolean;
			canEdit: boolean;
			canShare: boolean;
		};
	}[];
}) {
	if (!id || !shareArray?.length) throw new Error("No user to share!");

	const user = await getCurrentUser();

	if (!user) throw new Error(getMessage().UNAUTHORIZED_USER);

	const { dbUserConfig } = await checkPermissionForDbAction(
		user.id,
		id,
		"SHARE"
	);

	return await Promise.all(
		shareArray.map(
			async ({
				email,
				permissions = {
					canDelete: false,
					canEdit: false,
					canShare: false,
				},
			}) => {
				// Normalize email to lowercase for case-insensitive comparison
				const normalizedEmail = email.toLowerCase().trim();
				
				const [, user] = await asaw(
					prisma.user.findUnique({
						where: {
							email: normalizedEmail,
						},
					})
				);

				if (user?.id) {
					const [, dbConfigUser] = await asaw(
						prisma.databaseConfigUser.findFirst({
							where: {
								userId: user.id,
								databaseConfigId: id,
							},
						})
					);

					if (!dbConfigUser) {
						await addDatabaseConfigUserEntry(user.id, id, permissions);
						return [, { success: true }];
					}

					return [`Already shared to ${normalizedEmail}`, { success: false }];
				} else {
					const [createErr] = await asaw(
						prisma.databaseConfigInvitedUser.create({
							data: {
								email: normalizedEmail,
								databaseConfigId: id,
								canEdit: dbUserConfig.canEdit && permissions.canEdit,
								canDelete: dbUserConfig.canDelete && permissions.canDelete,
								canShare: dbUserConfig.canShare && permissions.canShare,
							},
						})
					);

					return [createErr, { success: !createErr }];
				}
			}
		)
	);
}

export async function moveSharedDBConfigToDBUser(
	email: string,
	userId: string
) {
	const [sharedConfigErr, sharedConfig] = await asaw(
		prisma.databaseConfigInvitedUser.findMany({
			where: {
				email,
			},
		})
	);

	if (sharedConfigErr) {
		consoleLog(sharedConfigErr);
		return;
	}

	if (!sharedConfig?.length) return;

	if (sharedConfig.length) {
		const [configAddErr] = await asaw(
			prisma.databaseConfigUser.createMany({
				data: sharedConfig.map(
					(sharedConfigObject: DatabaseConfigInvitedUser) => ({
						databaseConfigId: sharedConfigObject.databaseConfigId,
						userId,
						canDelete: sharedConfigObject.canDelete,
						canEdit: sharedConfigObject.canEdit,
						canShare: sharedConfigObject.canShare,
					})
				),
			})
		);

		const ifNoCurrentDbConfig = await prisma.databaseConfigUser.count({
			where: {
				userId,
				isCurrent: true,
			},
		});

		if (!ifNoCurrentDbConfig) {
			const firstDbConfig = await prisma.databaseConfigUser.findFirst({
				where: {
					userId,
				},
			});
			if (firstDbConfig) {
				await prisma.databaseConfigUser.update({
					data: {
						isCurrent: true,
					},
					where: {
						databaseConfigId_userId: {
							userId,
							databaseConfigId: firstDbConfig.databaseConfigId,
						},
					},
				});
			}
		}
	}

	return;
}

async function addDatabaseConfigUserEntry(
	userId: string,
	databaseConfigId: string,
	permissions: {
		canDelete: boolean;
		canEdit: boolean;
		canShare: boolean;
	}
) {
	// Get the database config to find its project
	const dbConfig = await prisma.databaseConfig.findUnique({
		where: { id: databaseConfigId },
		select: { projectId: true },
	});

	// Check if user has any current database config in the same project
	const existingCurrentConfigInOrg = await prisma.databaseConfigUser.findFirst({
		where: {
			userId: userId,
			isCurrent: true,
			databaseConfig: {
				projectId: dbConfig?.projectId || null,
			},
		},
	});

	await prisma.databaseConfigUser.create({
		data: {
			userId,
			databaseConfigId,
			isCurrent: !existingCurrentConfigInOrg,
			...permissions,
		},
	});
}

async function checkPermissionForDbAction(
	userId: string,
	databaseConfigId: string,
	actionType: "DELETE" | "SHARE" | "EDIT"
) {
	const [dbUserConfigErr, dbUserConfig] = await asaw(
		prisma.databaseConfigUser.findFirst({
			where: {
				databaseConfigId,
				userId,
			},
		})
	);

	if (dbUserConfigErr || !dbUserConfig)
		throw new Error(dbUserConfigErr || "Database config doesn't exist");

	switch (actionType) {
		case "DELETE":
			if (!dbUserConfig.canDelete)
				throw new Error(
					"User doesn't have permission to delete the database config"
				);
			break;
		case "EDIT":
			if (!dbUserConfig.canEdit)
				throw new Error(
					"User doesn't have permission to edit the database config"
				);
			break;
		case "SHARE":
			if (!dbUserConfig.canShare)
				throw new Error(
					"User doesn't have permission to share the database config"
				);
			break;
		default:
			break;
	}

	return {
		success: true,
		dbUserConfig,
	};
}
