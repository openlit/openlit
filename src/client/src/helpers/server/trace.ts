export { getTraceMappingKeyFullPath } from "../client/trace";

export const buildHierarchy = (data: any[]) => {
	// Create a map for quick lookup of nodes by SpanId
	const nodeMap = new Map();
	data.forEach((item) => {
		nodeMap.set(item.SpanId, { ...item, children: [] });
	});

	let root = null;

	// Build the hierarchy
	data.forEach((item) => {
		const node = nodeMap.get(item.SpanId);
		if (item.ParentSpanId === "") {
			// Root node found
			root = node;
		} else if (nodeMap.has(item.ParentSpanId)) {
			// Link the node to its parent
			const parent = nodeMap.get(item.ParentSpanId);
			parent.children.push(node);
		}
	});

	// Sort children at every level by Timestamp (chronological order)
	function sortChildren(node: any) {
		if (node?.children?.length) {
			node.children.sort((a: any, b: any) => {
				const tsA = a.Timestamp ? new Date(a.Timestamp).getTime() : 0;
				const tsB = b.Timestamp ? new Date(b.Timestamp).getTime() : 0;
				return tsA - tsB;
			});
			node.children.forEach(sortChildren);
		}
	}
	sortChildren(root);

	return root; // Returns the hierarchical tree
};
