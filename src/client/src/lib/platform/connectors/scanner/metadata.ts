/**
 * Serialized read-modify-write of scanner connector metadata.
 *
 * Scan jobs and enrich runs both live in `ConnectorInstance.metadata`. Updates
 * for one connector are chained in this process so a scan finishing while an
 * enrich run reports progress cannot drop either write.
 */

import prisma from "@/lib/prisma";

const queues = new Map<string, Promise<unknown>>();

export function parseJsonObject(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw || "{}");
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* keep empty */
	}
	return {};
}

export async function updateScannerMetadata(
	instanceId: string,
	update: (metadata: Record<string, unknown>) => Record<string, unknown>
): Promise<Record<string, unknown> | null> {
	const previous = queues.get(instanceId) || Promise.resolve();
	const next = previous
		.catch(() => undefined)
		.then(async () => {
			const existing = await prisma.connectorInstance.findFirst({
				where: { id: instanceId },
				select: { metadata: true },
			});
			if (!existing) return null;
			const metadata = update(parseJsonObject(existing.metadata || "{}"));
			await prisma.connectorInstance.update({
				where: { id: instanceId },
				data: { metadata: JSON.stringify(metadata) },
			});
			return metadata;
		});
	queues.set(instanceId, next);
	try {
		return await next;
	} finally {
		if (queues.get(instanceId) === next) queues.delete(instanceId);
	}
}
