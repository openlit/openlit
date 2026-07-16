import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { randomUUID } from "crypto";

/**
 * Stable, anonymous per-install identifier used only for OpenLIT usage
 * analytics (see the daily INSTANCE_TELEMETRY_SNAPSHOT event). It is a
 * random UUID with no link to any user, email, or hostname.
 *
 * We persist it inside the existing `ClickhouseMigrations` table (already
 * repurposed as a small key/value coordinator for the agents-materialize
 * lease) so the id survives container restarts and image upgrades without
 * adding a new Prisma model or writing to an ephemeral filesystem path.
 */
const INSTALL_ID_KEY = "telemetry:install-id";

export async function getInstallId(): Promise<string> {
	const [findErr, existing] = await asaw(
		prisma.clickhouseMigrations.findFirst({
			where: { databaseConfigId: INSTALL_ID_KEY },
		})
	);

	if (!findErr && existing) {
		return (existing as { clickhouseMigrationId: string }).clickhouseMigrationId;
	}

	const installId = randomUUID();
	// Create is best-effort: on a race two replicas may both try to create the
	// row. The unique-ish read above plus this create keep it simple; if the
	// create loses a race we just re-read.
	const [createErr] = await asaw(
		prisma.clickhouseMigrations.create({
			data: {
				databaseConfigId: INSTALL_ID_KEY,
				clickhouseMigrationId: installId,
			},
		})
	);

	if (createErr) {
		const [, row] = await asaw(
			prisma.clickhouseMigrations.findFirst({
				where: { databaseConfigId: INSTALL_ID_KEY },
			})
		);
		if (row) {
			return (row as { clickhouseMigrationId: string }).clickhouseMigrationId;
		}
	}

	return installId;
}
