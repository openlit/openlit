interface ClickHouseConnectionInfo {
	username: string;
	password: string;
	host: string;
	database: string;
	additional_headers: Record<string, string>;
}

export const parseClickHouseConnectionString = (
	connectionString: string
): ClickHouseConnectionInfo => {
	const regex =
		/clickhouse(?:\+(\w+))?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)(?:\?([^*]+))?/;

	const match = connectionString.match(regex);

	if (!match) {
		throw new Error("Invalid ClickHouse connection string format");
	}

	const [, , username, password, hostStr, portStr, database, queryParamsStr] =
		match;

	const port = parseInt(portStr, 10);

	const additional_headers: Record<string, string> = {};
	if (queryParamsStr) {
		queryParamsStr.split("&").forEach((param) => {
			const [key, value] = param.split("=");
			additional_headers[key] = value;
		});
	}

	const host = `${
		additional_headers["protocol"] || "http"
	}://${hostStr}:${port}`;

	return {
		username,
		password,
		host,
		database,
		additional_headers,
	};
};
