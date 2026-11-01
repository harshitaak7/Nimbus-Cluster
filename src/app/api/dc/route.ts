import { performAction, snapshot } from "@/lib/engine/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await snapshot(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; payload?: Record<string, unknown> };
  if (!body.action) return Response.json({ ok: false, error: "missing action" }, { status: 400 });
  return Response.json(await performAction(body.action, body.payload ?? {}));
}
