import { getCurrentUser } from "@/lib/session";
import { dataCollector } from "@/lib/platform/common";
import { validateSQL } from "@/lib/platform/chat/sql-validator";
import { updateMessage } from "@/lib/platform/chat/conversation";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
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
	});

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
