import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/auth";
import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import { OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME } from "@/lib/platform/openground/table-details";
import asaw from "@/utils/asaw";

// Extend the session type to include id
interface SessionWithId {
	user?: {
		id?: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
	};
}

// GET: Debug endpoint to check table status
export async function GET(request: NextRequest) {
	const session = (await getServerSession(authOptions)) as SessionWithId;

	if (!session?.user?.id) {
		return NextResponse.json(
			{ error: getMessage().UNAUTHORIZED_USER },
			{ status: 401 }
		);
	}

	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	if (!dbConfig?.id) {
		return NextResponse.json(
			{ error: getMessage().DATABASE_CONFIG_NOT_FOUND },
			{ status: 500 }
		);
	}

	// Check if table exists
	const checkTableQuery = `
		SELECT name
		FROM system.tables
		WHERE database = currentDatabase()
		AND name = '${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}'
	`;

	const { data: tableData, err: tableErr } = await dataCollector(
		{ query: checkTableQuery },
		"query",
		dbConfig.id
	);

	// Try to get table schema
	const schemaQuery = `DESCRIBE TABLE ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}`;
	const { data: schemaData, err: schemaErr } = await dataCollector(
		{ query: schemaQuery },
		"query",
		dbConfig.id
	);

	// Try to count rows
	const countQuery = `SELECT count() as count FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}`;
	const { data: countData, err: countErr } = await dataCollector(
		{ query: countQuery },
		"query",
		dbConfig.id
	);

	// Get actual data to see what's being stored
	const dataQuery = `SELECT toString(id) as id, provider, model_id, display_name FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME} LIMIT 5`;
	const { data: sampleData, err: dataQueryErr } = await dataCollector(
		{ query: dataQuery },
		"query",
		dbConfig.id
	);

	return NextResponse.json({
		tableName: OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME,
		databaseConfigId: dbConfig.id,
		userId: session.user.id,
		checks: {
			tableExists: {
				result: tableData,
				error: tableErr,
			},
			schema: {
				result: schemaData,
				error: schemaErr,
			},
			rowCount: {
				result: countData,
				error: countErr,
			},
			sampleData: {
				result: sampleData,
				error: dataQueryErr,
			},
		},
	});
}
