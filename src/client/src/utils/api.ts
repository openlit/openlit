type GET_DATA = {
	body?: string;
	method?: "GET" | "POST";
	url: string;
};

export async function getData({ body, method = "POST", url }: GET_DATA) {
	const res = await fetch(url, { body, method });
	if (!res.ok) {
		// This will activate the closest `error.js` Error Boundary
		const error = await res.json();
		throw new Error(error);
	}

	return res.json();
}

type DELETE_DATA = {
	url: string;
};

export async function deleteData({ url }: DELETE_DATA) {
	const res = await fetch(url, { method: "DELETE" });
	if (!res.ok) {
		// This will activate the closest `error.js` Error Boundary
		throw new Error("Failed to delete data");
	}

	return res.json();
}
