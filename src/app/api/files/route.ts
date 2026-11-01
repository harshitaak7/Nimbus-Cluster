import { errMsg } from "@/lib/engine/util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { listFiles } = await import("@/lib/engine/files");
    return Response.json(await listFiles());
  } catch (e) {
    return Response.json({ ok: false, error: errMsg(e) }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const { repairFiles, storeFile } = await import("@/lib/engine/files");
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = (await req.json()) as { action?: string; name?: string; content?: string; copies?: number };
      if (j.action === "repair") return Response.json({ ok: true, repaired: await repairFiles() });
      if (!j.name || typeof j.content !== "string") throw new Error("name and content required");
      const f = await storeFile({
        name: j.name,
        mime: "text/plain",
        data: Buffer.from(j.content, "utf8"),
        copies: j.copies ?? 2,
      });
      return Response.json({ ok: true, id: f.id });
    }
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("file field missing");
    const copies = Number(form.get("copies") ?? 2);
    const f = await storeFile({
      name: file.name,
      mime: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
      copies,
    });
    return Response.json({ ok: true, id: f.id });
  } catch (e) {
    return Response.json({ ok: false, error: errMsg(e) }, { status: 400 });
  }
}
