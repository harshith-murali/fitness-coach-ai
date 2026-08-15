import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { anonUserId, nickname } =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  if (typeof anonUserId !== "string" || !UUID_RE.test(anonUserId)) {
    return NextResponse.json({ error: "Missing or invalid anonUserId" }, { status: 400 });
  }

  const existing = await sql`SELECT id, nickname FROM users WHERE id = ${anonUserId}`;

  if (existing.length === 0) {
    if (typeof nickname !== "string" || nickname.trim().length < 2 || nickname.trim().length > 24) {
      return NextResponse.json(
        { error: "nickname is required for a new user (2-24 characters)" },
        { status: 400 }
      );
    }
    await sql`INSERT INTO users (id, nickname) VALUES (${anonUserId}, ${nickname.trim()})`;
    await sql`INSERT INTO user_stats (user_id) VALUES (${anonUserId}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO user_streaks (user_id) VALUES (${anonUserId}) ON CONFLICT DO NOTHING`;

    return NextResponse.json(
      { userId: anonUserId, nickname: nickname.trim(), isNewUser: true },
      { status: 200 }
    );
  }

  if (typeof nickname === "string" && nickname.trim().length >= 2 && nickname.trim().length <= 24) {
    await sql`
      UPDATE users SET nickname = ${nickname.trim()}, last_seen_at = now() WHERE id = ${anonUserId}
    `;
    return NextResponse.json(
      { userId: anonUserId, nickname: nickname.trim(), isNewUser: false },
      { status: 200 }
    );
  }

  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${anonUserId}`;
  return NextResponse.json(
    { userId: anonUserId, nickname: existing[0].nickname as string, isNewUser: false },
    { status: 200 }
  );
}
