import { getCurrentUser } from "@/lib/session";
import { dataCollector } from "@/lib/platform/common";
import { validateSQL } from "@/lib/platform/chat/sql-validator";
import { updateMessage } from "@/lib/platform/chat/conversation";
import { isNativeSqlChatAvailable } from "@/lib/telemetry-source";
import { TELEMETRY_SOURCE_CHAT_NATIVE_ONLY } from "@/constants/messages/en";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	// Natural-language SQL chat runs raw ClickHouse SQL, so it is only
	// available through the ClickHouse connector routed for intelligence.
	const environment = request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) || undefined;
	const chatSource = await isNativeSqlChatAvailable({
		signal: "intelligence",
		environment,
	});
	if (!chatSource.available) {
		return Response.json(
			{ err: TELEMETRY_SOURCE_CHAT_NATIVE_ONLY(chatSource.sourceName) },
			{ status: 409 }
		);
	}

	const body = await request.json();
	const { messageId, query } = body;

	if (!query) {
		return Response.json("Missing query", { status: 400 });
	}

	// Validate SQL
	const validation = validateSQL(query);
	if (!validation.valid) {
		return Response.json(
			{ err: validation.error },
			{ status: 400 }
		);
	}

	const startTime = Date.now();

	// Execute with readonly mode
	const { data, err } = await dataCollector({
		query: validation.query!,
		enable_readonly: true,
	}, "query", chatSource.databaseConfigId);

	const executionTimeMs = Date.now() - startTime;

	if (err) {
		return Response.json({ err }, { status: 400 });
	}

	const results = data as any[];
	const stats = {
		rowsRead: results?.length || 0,
		executionTimeMs,
		bytesRead: 0,
	};

	// Update message with query result and stats if messageId provided
	if (messageId) {
		await updateMessage(messageId, {
			queryResult: JSON.stringify(results || []),
			queryRowsRead: stats.rowsRead,
			queryExecutionTimeMs: stats.executionTimeMs,
			queryBytesRead: stats.bytesRead,
		});
	}

	return Response.json({ data: results, stats });
}
