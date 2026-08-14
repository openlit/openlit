import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("Authorization") || "";
	if (!authHeader.startsWith("Bearer ")) {
		return NextResponse.json({ valid: false }, { status: 401 });
	}

	const apiKey = authHeader.replace(/^Bearer /, "").trim();
	if (!apiKey) {
		return NextResponse.json({ valid: false }, { status: 401 });
	}

	try {
		const apiInfo = await prisma.aPIKeys.findFirst({
			where: {
				apiKey,
				isDeleted: false,
			},
		});

		if (apiInfo?.databaseConfigId) {
			return NextResponse.json({
				valid: true,
				databaseConfigId: apiInfo.databaseConfigId,
			});
		}
	} catch (e) {
		console.error("Auth verification route error:", e);
	}

	return NextResponse.json({ valid: false }, { status: 401 });
}
