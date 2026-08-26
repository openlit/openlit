import { jsonParse } from "@/utils/json";
import type { Widget } from "@/types/manage-dashboard";

/** Legacy / unversioned dashboard JSON (seed files and pre-v2 exports). */
export const DASHBOARD_FORMAT_VERSION_V1 = 1;
/** Current portable dashboard export format. */
export const DASHBOARD_FORMAT_VERSION_V2 = 2;
export const CURRENT_DASHBOARD_FORMAT_VERSION = DASHBOARD_FORMAT_VERSION_V2;

export type DashboardLayoutItem = {
	i: string;
	x: number;
	y: number;
	w: number;
	h: number;
};

export type NormalizedDashboardImport = {
	formatVersion: number;
	title: string;
	description: string;
	isPinned: boolean;
	isMainDashboard: boolean;
	tags: string[];
	layouts: { lg: DashboardLayoutItem[] };
	widgets: Record<string, Widget>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/**
 * Detect dashboard JSON format. Missing / unknown version is treated as v1
 * so older exported layouts and seed files keep working.
 */
export function detectDashboardFormatVersion(data: unknown): number {
	const record = asRecord(data);
	if (!record) return DASHBOARD_FORMAT_VERSION_V1;
	const version = record.formatVersion;
	if (version === 2 || version === "2" || version === "v2") {
		return DASHBOARD_FORMAT_VERSION_V2;
	}
	if (version === 1 || version === "1" || version === "v1") {
		return DASHBOARD_FORMAT_VERSION_V1;
	}
	return DASHBOARD_FORMAT_VERSION_V1;
}

/** Normalize tags whether they arrived as an array, JSON string, or missing. */
export function normalizeDashboardTags(tags: unknown): string[] {
	if (Array.isArray(tags)) {
		return tags
			.map((tag) => String(tag ?? "").trim())
			.filter((tag) => tag.length > 0);
	}
	if (typeof tags === "string") {
		const trimmed = tags.trim();
		if (!trimmed) return [];
		const parsed = jsonParse(trimmed);
		if (Array.isArray(parsed)) {
			return normalizeDashboardTags(parsed);
		}
		return [trimmed];
	}
	return [];
}

function normalizeLayoutItem(
	item: unknown,
	fallbackId: string
): DashboardLayoutItem | null {
	const record = asRecord(item);
	if (!record) return null;
	const i = typeof record.i === "string" && record.i ? record.i : fallbackId;
	const x = Number(record.x);
	const y = Number(record.y);
	const w = Number(record.w);
	const h = Number(record.h);
	if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
	return { i, x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

function normalizeWidgets(widgets: unknown): Record<string, Widget> {
	const record = asRecord(widgets);
	if (!record) return {};
	const out: Record<string, Widget> = Object.create(null);
	for (const [key, value] of Object.entries(record)) {
		const widget = asRecord(value);
		if (!widget) continue;
		const id =
			typeof widget.id === "string" && widget.id ? widget.id : key;
		if (
			id === "__proto__" ||
			id === "constructor" ||
			id === "prototype" ||
			!/^[A-Za-z0-9_.:-]+$/.test(id)
		) {
			continue;
		}
		out[id] = {
			...(widget as unknown as Widget),
			id,
			title: typeof widget.title === "string" ? widget.title : "",
			description:
				typeof widget.description === "string" ? widget.description : "",
			type: typeof widget.type === "string" ? widget.type : "",
			properties:
				widget.properties && typeof widget.properties === "object"
					? (widget.properties as Record<string, unknown>)
					: {},
			config:
				widget.config && typeof widget.config === "object"
					? (widget.config as Widget["config"])
					: {},
			createdAt:
				typeof widget.createdAt === "string" ? widget.createdAt : "",
			updatedAt:
				typeof widget.updatedAt === "string" ? widget.updatedAt : "",
		};
	}
	return out;
}

function normalizeLayouts(
	layouts: unknown,
	widgetIds: string[]
): { lg: DashboardLayoutItem[] } {
	const record = asRecord(layouts);
	const rawLg = Array.isArray(record?.lg) ? record!.lg : [];
	const lg: DashboardLayoutItem[] = [];
	rawLg.forEach((item, index) => {
		const normalized = normalizeLayoutItem(
			item,
			widgetIds[index] || `widget-${index}`
		);
		if (normalized) lg.push(normalized);
	});

	// When layouts are missing (corrupt export), place widgets in a simple grid.
	if (lg.length === 0 && widgetIds.length > 0) {
		widgetIds.forEach((id, index) => {
			lg.push({
				i: id,
				x: (index % 4) * 3,
				y: Math.floor(index / 4) * 2,
				w: 3,
				h: 2,
			});
		});
	}

	return { lg };
}

/**
 * Validate and normalize an imported dashboard payload (v1 or v2) into the
 * internal shape used by `importBoardLayout`.
 */
export function normalizeImportedDashboard(
	data: unknown
): { data: NormalizedDashboardImport } | { err: string } {
	const record = asRecord(data);
	if (!record) {
		return { err: "Dashboard import must be a JSON object." };
	}

	const title = typeof record.title === "string" ? record.title.trim() : "";
	if (!title) {
		return { err: "Dashboard import requires a title." };
	}

	const widgets = normalizeWidgets(record.widgets);
	const widgetIds = Object.keys(widgets);
	const layouts = normalizeLayouts(record.layouts, widgetIds);

	// Drop layout entries that point at missing widgets; keep widgets that
	// lack a layout cell by synthesizing one later in normalizeLayouts.
	const knownWidgetIds = new Set(widgetIds);
	const filteredLg = layouts.lg.filter((item) => knownWidgetIds.has(item.i));
	const laidOut = new Set(filteredLg.map((item) => item.i));
	widgetIds.forEach((id, index) => {
		if (!laidOut.has(id)) {
			filteredLg.push({
				i: id,
				x: (index % 4) * 3,
				y: Math.floor(index / 4) * 2,
				w: 3,
				h: 2,
			});
		}
	});

	return {
		data: {
			formatVersion: detectDashboardFormatVersion(record),
			title,
			description:
				typeof record.description === "string" ? record.description : "",
			isPinned: Boolean(record.isPinned),
			isMainDashboard: Boolean(record.isMainDashboard),
			tags: normalizeDashboardTags(record.tags),
			layouts: { lg: filteredLg },
			widgets,
		},
	};
}

/**
 * Build a v2 export payload from `getBoardLayout` output. Older clients that
 * ignore `formatVersion` can still import the shared title/layouts/widgets
 * fields via the v1 path.
 */
export function toExportDashboardPayload(
	boardLayout: Record<string, unknown>
): Record<string, unknown> {
	const widgets = normalizeWidgets(boardLayout.widgets);
	const layouts = normalizeLayouts(boardLayout.layouts, Object.keys(widgets));

	return {
		formatVersion: CURRENT_DASHBOARD_FORMAT_VERSION,
		title:
			typeof boardLayout.title === "string" ? boardLayout.title : "Dashboard",
		description:
			typeof boardLayout.description === "string"
				? boardLayout.description
				: "",
		isPinned: Boolean(boardLayout.isPinned),
		isMainDashboard: Boolean(boardLayout.isMainDashboard),
		tags: normalizeDashboardTags(boardLayout.tags),
		layouts,
		widgets,
	};
}
