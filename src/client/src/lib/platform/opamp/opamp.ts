import asaw from "@/utils/asaw";
import { jsonStringify } from "@/utils/json";
import { consoleLog } from "@/utils/log";

const baseUrl = "http://127.0.0.1:8080";

export async function getAllAgents() {
	const [err, res]: any = await asaw(fetch(`${baseUrl}/api/agents`, {
		headers: {
			"Content-type": "application/json"
		},
		cache: 'no-store'
	}));

	if (err) {
		return {
			err
		};
	}

	const data = await res.json();

	return {
		data
	};
}

export async function getAgentByInstanceId(id: string) {
	const [err, res]: any = await asaw(fetch(`${baseUrl}/api/agent?id=${id}`, {
		headers: {
			"Content-type": "application/json"
		},
		cache: "no-store"
	}));

	if (err) {
		return {
			err
		};
	}

	const data = await res.json();

	return {
		data
	};
}

export async function updateAgentConfig(id: string, config: string) {
	const [err, res]: any = await asaw(fetch(`${baseUrl}/api/agent/config`, {
		method: "POST",
		headers: {
			"Content-type": "application/json"
		},
		body: jsonStringify({
			id,
			config,
		}),
	}));

	if (err) {
		consoleLog(err);
		return {
			err
		};
	}

	await new Promise(resolve => setTimeout(resolve, 2000));

	return {
		data: res
	};
}

export async function updateTlsConnection(id: string, tls_min: string) {
	const [err, res]: any = await asaw(fetch(`${baseUrl}/api/agent/connection`, {
		method: "POST",
		headers: {
			"Content-type": "application/json"
		},
		body: jsonStringify({
			id,
			tls_min,
		}),
	}));

	if (err) {
		return {
			err
		};
	}

	return {
		data: res
	};
}