import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Callback target for the n8n AI Agent's create_challenge Tool node. Not
// gated behind x-anon-id (n8n has no browser localStorage) — the caller
// supplies anonUserId directly in the body instead. See
// workflows/validate_workflow.md for the exact Tool node contract.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { anonUserId, title, targetCount, durationDays, metric } =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  if (typeof anonUserId !== "string" || !UUID_RE.test(anonUserId)) {
    return NextResponse.json({ error: "Missing or invalid anonUserId" }, { status: 400 });
  }
  if (typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "Missing required field: title" }, { status: 400 });
  }
  if (typeof targetCount !== "number" || !Number.isFinite(targetCount) || targetCount <= 0) {
    return NextResponse.json({ error: "Missing or invalid field: targetCount" }, { status: 400 });
  }
  if (typeof durationDays !== "number" || !Number.isFinite(durationDays) || durationDays <= 0) {
    return NextResponse.json({ error: "Missing or invalid field: durationDays" }, { status: 400 });
  }
  const resolvedMetric = metric === "check_ins" ? "check_ins" : "workout_logs";

  const userRows = await sql`SELECT id FROM users WHERE id = ${anonUserId}`;
  if (userRows.length === 0) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  const inserted = await sql`
    INSERT INTO challenges (user_id, title, target_count, metric, deadline)
    VALUES (
      ${anonUserId},
      ${title.trim()},
      ${Math.round(targetCount)},
      ${resolvedMetric},
      now() + (${durationDays} || ' days')::interval
    )
    RETURNING id, title, target_count, deadline, status
  `;
  const c = inserted[0] as {
    id: string;
    title: string;
    target_count: number;
    deadline: string;
    status: string;
  };

  return NextResponse.json(
    {
      challengeId: c.id,
      title: c.title,
      targetCount: c.target_count,
      deadline: c.deadline,
      status: c.status,
    },
    { status: 201 }
  );
}
