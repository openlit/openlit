export {
	getTraceMappingKeyFullPath,
	getTraceMappingKeyFullPaths,
	getTraceMappingValue,
} from "../client/trace";

const ZERO_PARENTS = new Set(["0".repeat(16), "0".repeat(32)]);

function isEmptyParent(parentId: unknown): boolean {
	if (parentId == null || parentId === "") return true;
	return ZERO_PARENTS.has(String(parentId));
}

function compareTimestamp(a: any, b: any): number {
	const tsA = a?.Timestamp ? new Date(a.Timestamp).getTime() : 0;
	const tsB = b?.Timestamp ? new Date(b.Timestamp).getTime() : 0;
	return tsA - tsB;
}

function sortChildren(node: any) {
	if (node?.children?.length) {
		node.children.sort(compareTimestamp);
		node.children.forEach(sortChildren);
	}
}

/**
 * Build a ParentSpanId tree for the trace detail UI.
 *
 * Incomplete Jaeger/OTEL exports often omit the true root while every
 * remaining span still points at it. When no empty-parent root exists, promote
 * those orphan tops into a forest and return the earliest as the primary root
 * (siblings hang under it) so hierarchy/detail APIs do not fail closed.
 */
export const buildHierarchy = (data: any[]) => {
	if (!Array.isArray(data) || data.length === 0) return null;

	const nodeMap = new Map<string, any>();
	data.forEach((item) => {
		if (!item?.SpanId) return;
		nodeMap.set(item.SpanId, { ...item, children: [] });
	});
	if (nodeMap.size === 0) return null;

	const explicitRoots: any[] = [];
	const orphans: any[] = [];

	data.forEach((item) => {
		const node = nodeMap.get(item.SpanId);
		if (!node) return;
		if (isEmptyParent(item.ParentSpanId)) {
			explicitRoots.push(node);
			return;
		}
		if (nodeMap.has(item.ParentSpanId)) {
			nodeMap.get(item.ParentSpanId).children.push(node);
			return;
		}
		orphans.push(node);
	});

	// Prefer real roots; only promote orphans when the backend omitted them.
	const roots = explicitRoots.length > 0 ? explicitRoots : orphans;
	if (roots.length === 0) return null;

	roots.sort(compareTimestamp);
	const primary = roots[0];
	for (const sibling of roots.slice(1)) {
		primary.children.push(sibling);
	}
	sortChildren(primary);
	return primary;
};
