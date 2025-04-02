import {
	createFolder,
	getFolders,
	updateFolder,
} from "@/lib/platform/dashlit/folder";
import { Folder } from "@/types/dashlit";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const folder: Folder = await request.json();

	const res = await createFolder(folder);
	return Response.json(res);
}

export async function PUT(request: NextRequest) {
	const folder: Folder = await request.json();

	const res = await updateFolder(folder);
	return Response.json(res);
}

export async function GET() {
	const res = await getFolders();
	return Response.json(res);
}
