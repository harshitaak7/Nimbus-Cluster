export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json({ ok: false, error: "DATABASE_URL is required" }, { status: 503 });
  }
  try {
    const [{ db }, { sql }] = await Promise.all([import("@/db"), import("drizzle-orm")]);
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "database unavailable" }, { status: 503 });
  }
}
