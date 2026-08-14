export const unescapeString = (str: string) => str.replace(/\\n/g, "\n");

export const convertToTitleCase = (str: string) => str.replace(/_|-/g, " ").replace(/\b\w/g, char => char.toUpperCase());

export const escapeHtml = (str: string) =>
	str.replace(/[&<>"'`]/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
			case "`":
				return "&#96;";
			default:
				return char;
		}
	});

export const escapeEmailForDisplay = (email?: string | null) =>
	email ? escapeHtml(email) : "";
