import { Prisma, PrismaClient } from ".prisma/client";

export const TABLE_NAME = "doku";

export type TimeLimit = {
	start: Date;
	end: Date;
};

export interface DokuParams {
	timeLimit: TimeLimit;
}

export type DokuRequestParams = DokuParams & {
	config?: {
		endpoints?: boolean;
		maxUsageCost?: boolean;
		models?: boolean;
		totalRows?: boolean;
	};
	offset?: number;
	limit?: number;
};

const prisma = new PrismaClient();

export type DataCollectorType = { err?: unknown; data: unknown };
export async function dataCollector(query: string): Promise<DataCollectorType> {
	try {
		const response = await prisma.$queryRaw`${Prisma.raw(query)}`;
		return { data: response };
	} catch (err) {
		console.trace(err);
		return { err, data: [] };
	} finally {
		prisma.$disconnect();
	}
}
