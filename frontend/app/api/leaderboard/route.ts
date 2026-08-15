import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { levelForXp } from "@/lib/gamification";
import { optionalAnonId } from "@/lib/identity";

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsed = limitParam ? parseInt(limitParam, 10) : 50;
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;

  const rows = await sql`
    SELECT u.id AS user_id, u.nickname, u.created_at, s.total_xp
    FROM users u JOIN user_stats s ON s.user_id = u.id
    ORDER BY s.total_xp DESC, u.created_at ASC
    LIMIT ${limit}
  `;

  const entries = (
    rows as { user_id: string; nickname: string; created_at: string; total_xp: number }[]
  ).map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    nickname: r.nickname,
    totalXp: r.total_xp,
    level: levelForXp(r.total_xp),
  }));

  const anonId = optionalAnonId(request);
  let self = null;
  if (anonId) {
    const selfRank = await sql`
      SELECT rank, user_id, nickname, total_xp FROM (
        SELECT u.id AS user_id, u.nickname, s.total_xp,
               ROW_NUMBER() OVER (ORDER BY s.total_xp DESC, u.created_at ASC) AS rank
        FROM users u JOIN user_stats s ON s.user_id = u.id
      ) ranked
      WHERE user_id = ${anonId}
    `;
    if (selfRank.length > 0) {
      const r = selfRank[0] as { rank: number | string; user_id: string; nickname: string; total_xp: number };
      self = {
        rank: Number(r.rank),
        userId: r.user_id,
        nickname: r.nickname,
        totalXp: r.total_xp,
        level: levelForXp(r.total_xp),
      };
    }
  }

  return NextResponse.json({ entries, self });
}
