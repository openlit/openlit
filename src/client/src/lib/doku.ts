import { Prisma, PrismaClient } from "@prisma/client";

const TABLE_NAME = "doku";

export type TimeLimit =
	| "last-1-hour"
	| "last-1-week"
	| "last-1-month"
	| "custom";

export interface DokuParams {
	timeLimit?: TimeLimit;
	startDate?: Date;
	endDate?: Date;
}

type ConditionType = "OR" | "AND";
const addCondition = (
	query: string,
	condition: string,
	conditionType: ConditionType = "AND"
) =>
	query.includes("WHERE")
		? `${query} ${conditionType} ${condition}`
		: `${query} WHERE ${condition}`;

const prisma = new PrismaClient();
export async function getData(params: DokuParams = {}) {
	let query = `Select * from ${TABLE_NAME}`;
	switch (params.timeLimit) {
		case "last-1-hour":
			query = addCondition(
				query,
				`time >= CURRENT_TIMESTAMP - INTERVAL '1 hour' AND time < CURRENT_TIMESTAMP`
			);
			break;
		case "last-1-week":
			query = addCondition(
				query,
				`time >= CURRENT_TIMESTAMP - INTERVAL '1 week' AND time < CURRENT_TIMESTAMP`
			);
			break;
		case "last-1-month":
			query = addCondition(
				query,
				`time >= CURRENT_TIMESTAMP - INTERVAL '1 month' AND time < CURRENT_TIMESTAMP`
			);
			break;
		case "custom":
			if (params.startDate && params.endDate) {
				query = addCondition(
					query,
					`time >= '${params.startDate}' AND time < '${params.endDate}'`
				);
			}
			break;
		default:
			break;
	}

	try {
		const response = await prisma.$queryRaw`${Prisma.raw(query)}`;
		return { data: response };
	} catch (err) {
		return { err, data: [] };
	} finally {
		prisma.$disconnect();
	}
}
