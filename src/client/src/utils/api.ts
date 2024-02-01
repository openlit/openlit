type GET_DATA = {
	body: string;
	method?: "GET" | "POST";
	url: string;
};

export async function getData({ body, method = "POST", url }: GET_DATA) {
	const res = await fetch(url, { body, method });
	if (!res.ok) {
		// This will activate the closest `error.js` Error Boundary
		throw new Error("Failed to fetch data");
	}

	return res.json();
}
