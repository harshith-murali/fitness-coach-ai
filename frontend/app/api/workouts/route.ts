import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { awardWorkoutXp, evaluateStreakAndCheckIn, levelProgress } from "@/lib/gamification";
import { requireAnonId } from "@/lib/identity";

export async function POST(request: NextRequest) {
  const anonId = requireAnonId(request);
  if (anonId instanceof NextResponse) return anonId;

  const userRows = await sql`SELECT id FROM users WHERE id = ${anonId}`;
  if (userRows.length === 0) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { activity, performedAt, durationMinutes } =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  if (typeof activity !== "string" || activity.trim() === "") {
    return NextResponse.json({ error: "Missing required field: activity" }, { status: 400 });
  }
  if (typeof performedAt !== "string" || Number.isNaN(Date.parse(performedAt))) {
    return NextResponse.json({ error: "Missing or invalid field: performedAt" }, { status: 400 });
  }
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return NextResponse.json({ error: "Missing or invalid field: durationMinutes" }, { status: 400 });
  }

  const inserted = await sql`
    INSERT INTO workout_logs (user_id, activity, performed_at, duration_minutes)
    VALUES (${anonId}, ${activity.trim()}, ${performedAt}, ${Math.round(durationMinutes)})
    RETURNING id
  `;
  const workoutId = inserted[0].id as string;

  const streakResult = await evaluateStreakAndCheckIn(anonId);
  const workoutResult = await awardWorkoutXp(anonId);

  const statsRows = await sql`SELECT total_xp FROM user_stats WHERE user_id = ${anonId}`;
  const totalXp = statsRows[0].total_xp as number;
  const { level } = levelProgress(totalXp);

  const xpAwarded =
    workoutResult.xpAwarded + (streakResult.dailyCheckInAwarded ? 20 : 0);

  return NextResponse.json(
    {
      workoutId,
      xpAwarded,
      dailyCheckInAwarded: streakResult.dailyCheckInAwarded,
      streak: streakResult.streak,
      newBadges: [...streakResult.newBadges, ...workoutResult.newBadges],
      completedChallenges: workoutResult.completedChallenges,
      totalXp,
      level,
    },
    { status: 201 }
  );
}
