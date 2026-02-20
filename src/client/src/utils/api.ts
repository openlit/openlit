type GET_DATA = {
	body?: string;
	method?: "GET" | "POST" | "PUT" | "PATCH";
	url: string;
	data?: Record<string, unknown>;
};

export async function getData({ body, method = "POST", url, data }: GET_DATA) {
	const res = await fetch(url, {
		body: body || (data ? JSON.stringify(data) : undefined),
		method,
		headers: data ? { "Content-Type": "application/json" } : undefined,
	});
	if (!res.ok) {
		// This will activate the closest `error.js` Error Boundary
		const error = await res.json();
		throw new Error(error);
	}

	return res.json();
}

type POST_DATA = {
	url: string;
	data: Record<string, unknown>;
};

export async function postData({ url, data }: POST_DATA) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	if (!res.ok) {
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
		const error = await res.json();
		throw new Error(error);
	}

	return res.json();
}
