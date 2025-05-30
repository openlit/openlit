import { importBoardLayout } from "@/lib/platform/manage-dashboard/board";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const data = await request.json();
  const { err, data: boardData } = await importBoardLayout(data);

  if (err) {
    return new Response(JSON.stringify({ error: err }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ data: boardData }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
