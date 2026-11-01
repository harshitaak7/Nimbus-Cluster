import { deleteFile, fetchFile } from "@/lib/engine/files";
import { getNode } from "@/lib/engine/cluster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/files/:id            → download (served by a live replica, round robin)
 *  GET /api/files/:id?text=1     → JSON { name, text } (used by MapReduce) */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const r = await fetchFile(Number(id));
  if (!r) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (!r.servedBy)
    return Response.json({ ok: false, error: "all replicas of this file are offline" }, { status: 503 });
  const buf = Buffer.from(r.file.content, "base64");
  const url = new URL(req.url);
  if (url.searchParams.get("text")) {
    return Response.json({ ok: true, name: r.file.name, text: buf.toString("utf8"), servedBy: r.servedBy });
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": r.file.mime,
      "Content-Disposition": `attachment; filename="${r.file.name.replace(/"/g, "")}"`,
      "X-Served-By": getNode(r.servedBy).name,
      "X-Checksum-SHA256": r.file.checksum,
    },
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const ok = await deleteFile(Number(id));
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
