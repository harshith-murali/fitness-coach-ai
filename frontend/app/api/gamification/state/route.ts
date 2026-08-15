import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { levelProgress, sweepChallenges } from "@/lib/gamification";
import { requireAnonId } from "@/lib/identity";

export async function GET(request: NextRequest) {
  const anonId = requireAnonId(request);
  if (anonId instanceof NextResponse) return anonId;

  const userRows = await sql`SELECT nickname FROM users WHERE id = ${anonId}`;
  if (userRows.length === 0) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  await sweepChallenges(anonId);

  const [statsRows, streakRows, badgeRows, challengeRows] = await Promise.all([
    sql`SELECT total_xp FROM user_stats WHERE user_id = ${anonId}`,
    sql`SELECT current_streak, longest_streak, last_check_in_date FROM user_streaks WHERE user_id = ${anonId}`,
    sql`
      SELECT b.code, b.name, b.icon, ub.earned_at
      FROM user_badges ub JOIN badge_catalog b ON b.code = ub.badge_code
      WHERE ub.user_id = ${anonId} ORDER BY ub.earned_at DESC
    `,
    sql`
      SELECT id, title, target_count, current_count, metric, deadline, status
      FROM challenges WHERE user_id = ${anonId} AND status = 'active'
      ORDER BY created_at DESC
    `,
  ]);

  const totalXp = statsRows[0].total_xp as number;
  const { level, xpIntoLevel, xpForNextLevel } = levelProgress(totalXp);
  const streak = streakRows[0] as {
    current_streak: number;
    longest_streak: number;
    last_check_in_date: string | null;
  };

  return NextResponse.json({
    userId: anonId,
    nickname: userRows[0].nickname,
    totalXp,
    level,
    xpIntoLevel,
    xpForNextLevel,
    currentStreak: streak.current_streak,
    longestStreak: streak.longest_streak,
    lastCheckInDate: streak.last_check_in_date,
    badges: (badgeRows as { code: string; name: string; icon: string | null; earned_at: string }[]).map(
      (b) => ({ code: b.code, name: b.name, icon: b.icon, earnedAt: b.earned_at })
    ),
    activeChallenges: (
      challengeRows as {
        id: string;
        title: string;
        target_count: number;
        current_count: number;
        metric: string;
        deadline: string;
        status: string;
      }[]
    ).map((c) => ({
      id: c.id,
      title: c.title,
      targetCount: c.target_count,
      currentCount: c.current_count,
      metric: c.metric,
      deadline: c.deadline,
      status: c.status,
    })),
  });
}
