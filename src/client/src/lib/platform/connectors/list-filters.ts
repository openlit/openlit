export const CONNECTOR_FILTER_ALL_VALUE = "all";

export function configuredConnectorMatches(input: {
	query: string;
	typeFilter: string;
	categoryFilter: string;
	signalFilter: string;
	type: string;
	category: string;
	signals: string[];
	searchText: string;
}): boolean {
	if (input.typeFilter !== CONNECTOR_FILTER_ALL_VALUE && input.type !== input.typeFilter) return false;
	if (input.categoryFilter !== CONNECTOR_FILTER_ALL_VALUE && input.category !== input.categoryFilter) {
		return false;
	}
	if (
		input.signalFilter !== CONNECTOR_FILTER_ALL_VALUE &&
		!input.signals.includes(input.signalFilter)
	) {
		return false;
	}
	const query = input.query.trim().toLowerCase();
	if (!query) return true;
	return input.searchText.toLowerCase().includes(query);
}
