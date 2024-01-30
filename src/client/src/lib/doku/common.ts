import { Prisma, PrismaClient } from ".prisma/client";

export const TABLE_NAME = "doku";

export type TimeLimit = {
	start: Date;
	end: Date;
};

export interface DokuParams {
	timeLimit: TimeLimit;
}

const prisma = new PrismaClient();
export async function dataCollector(query: string) {
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
