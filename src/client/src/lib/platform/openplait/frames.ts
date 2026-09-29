import type { DataFrame } from "@openplait/core";

/** Convert OpenPlait's columnar frames to the row shape legacy OpenLIT reads use. */
export function openPlaitFramesToRows(
	frames: readonly DataFrame[]
): Record<string, unknown>[] {
	const rows: Record<string, unknown>[] = [];
	for (const frame of frames) {
		for (let index = 0; index < frame.length; index += 1) {
			const row: Record<string, unknown> = {};
			for (const field of frame.fields) row[field.name] = field.values[index];
			rows.push(row);
		}
	}
	return rows;
}
