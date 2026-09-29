/**
 * Durable source links for memories copied between connectors.
 */

import type { MemoryPortLink, MemoryRecord } from "./types";

export function memoryContentFingerprint(
	content: string,
	userId?: string
): string {
	const key = `${content.trim().toLowerCase()}\n${String(userId || "").trim()}`;
	let hash = 0;
	for (let i = 0; i < key.length; i += 1) {
		hash = (hash * 31 + key.charCodeAt(i)) | 0;
	}
	return Math.abs(hash).toString(16);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

export function parseMemoryPortLink(
	metadata?: Record<string, unknown> | null
): MemoryPortLink | undefined {
	const nested = asRecord(asRecord(asRecord(metadata).openlit).port);
	const raw = Object.keys(nested).length ? nested : asRecord(metadata).openlitPort;
	const sourceConnectorId = stringValue(asRecord(raw).sourceConnectorId);
	const sourceMemoryId = stringValue(asRecord(raw).sourceMemoryId);
	if (!sourceConnectorId || !sourceMemoryId) return undefined;
	return {
		sourceConnectorId,
		sourceConnectorType: stringValue(asRecord(raw).sourceConnectorType),
		sourceConnectorName: stringValue(asRecord(raw).sourceConnectorName),
		sourceMemoryId,
		originConnectorId: stringValue(asRecord(raw).originConnectorId),
		originMemoryId: stringValue(asRecord(raw).originMemoryId),
		copiedAt: stringValue(asRecord(raw).copiedAt) || "",
		contentFingerprint: stringValue(asRecord(raw).contentFingerprint) || "",
		destMemoryId: stringValue(asRecord(raw).destMemoryId),
	};
}

export function attachMemoryPorts<T extends MemoryRecord>(
	records: T[],
	stored: MemoryPortLink[] = []
): T[] {
	return records.map((record) => {
		const fromMetadata = parseMemoryPortLink(record.metadata);
		const fingerprint = memoryContentFingerprint(record.content, record.userId);
		const fromStore = stored.find(
			(link) =>
				link.destMemoryId === record.id ||
				(!!link.contentFingerprint && link.contentFingerprint === fingerprint)
		);
		const port = fromMetadata || fromStore;
		if (!port) return record;
		return { ...record, port };
	});
}

export function memoryPortMetadata(
	link: MemoryPortLink,
	existing?: Record<string, unknown>
): Record<string, unknown> {
	const current = { ...(existing || {}) };
	const openlit = asRecord(current.openlit);
	return {
		...current,
		openlit: {
			...openlit,
			port: {
				sourceConnectorId: link.sourceConnectorId,
				sourceConnectorType: link.sourceConnectorType,
				sourceConnectorName: link.sourceConnectorName,
				sourceMemoryId: link.sourceMemoryId,
				originConnectorId: link.originConnectorId,
				originMemoryId: link.originMemoryId,
				copiedAt: link.copiedAt,
				contentFingerprint: link.contentFingerprint,
			},
		},
	};
}
