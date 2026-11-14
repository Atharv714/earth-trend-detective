import { getCatalog } from "@/lib/server/catalog";

export async function GET() {
  return Response.json(getCatalog());
}
