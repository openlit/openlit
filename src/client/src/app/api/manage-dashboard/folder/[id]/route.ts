import { deleteFolder, getFolderById } from "@/lib/platform/manage-dashboard/folder";
import { NextRequest } from "next/server";

export async function DELETE(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await deleteFolder(id);
	return Response.json(res);
}

export async function GET(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await getFolderById(id);
	return Response.json(res);
}
