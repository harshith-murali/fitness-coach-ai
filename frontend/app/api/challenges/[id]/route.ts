import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { sweepChallenges } from "@/lib/gamification";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rows = await sql`
    SELECT id, user_id, title, target_count, current_count, metric, deadline, status
    FROM challenges WHERE id = ${id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }

  const c = rows[0] as {
    id: string;
    user_id: string;
    title: string;
    target_count: number;
    current_count: number;
    metric: string;
    deadline: string;
    status: string;
  };

  if (c.status === "active") {
    await sweepChallenges(c.user_id);
    const refreshed = await sql`
      SELECT id, title, target_count, current_count, metric, deadline, status
      FROM challenges WHERE id = ${id}
    `;
    const r = refreshed[0] as typeof c;
    return NextResponse.json({
      challengeId: r.id,
      title: r.title,
      targetCount: r.target_count,
      currentCount: r.current_count,
      metric: r.metric,
      deadline: r.deadline,
      status: r.status,
    });
  }

  return NextResponse.json({
    challengeId: c.id,
    title: c.title,
    targetCount: c.target_count,
    currentCount: c.current_count,
    metric: c.metric,
    deadline: c.deadline,
    status: c.status,
  });
}
