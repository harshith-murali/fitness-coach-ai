import { sql } from "./db";

export const XP = {
  CHAT_TURN: 5,
  DAILY_CHECK_IN: 20,
  WORKOUT_LOGGED: 25,
  CHALLENGE_COMPLETED: 75,
} as const;

// Cumulative XP required for level L: 100*(L-1)^2 + 100*(L-1).
// Iterated rather than solved in closed form to avoid float precision bugs
// around the level boundaries (level counts stay small for this app).
function xpRequiredForLevel(level: number): number {
  return 100 * (level - 1) * (level - 1) + 100 * (level - 1);
}

export function levelForXp(totalXp: number): number {
  let level = 1;
  while (xpRequiredForLevel(level + 1) <= totalXp) {
    level += 1;
  }
  return level;
}

export function levelProgress(totalXp: number) {
  const level = levelForXp(totalXp);
  const xpIntoLevel = totalXp - xpRequiredForLevel(level);
  const xpForNextLevel = xpRequiredForLevel(level + 1) - xpRequiredForLevel(level);
  return { level, xpIntoLevel, xpForNextLevel };
}

export type Badge = {
  code: string;
  name: string;
  description: string;
  icon: string | null;
  xpBonus: number;
};

// Adds `amount` XP to the user's total and keeps `level` in sync in the same
// row. Callers must run this inside their own transaction alongside the
// triggering write (chat turn, workout log, challenge completion, badge).
async function addXp(userId: string, amount: number): Promise<number> {
  if (amount === 0) {
    const rows = await sql`SELECT total_xp FROM user_stats WHERE user_id = ${userId}`;
    return (rows[0]?.total_xp as number) ?? 0;
  }
  const rows = await sql`
    UPDATE user_stats
    SET total_xp = total_xp + ${amount}, updated_at = now()
    WHERE user_id = ${userId}
    RETURNING total_xp
  `;
  const totalXp = rows[0].total_xp as number;
  const level = levelForXp(totalXp);
  await sql`UPDATE user_stats SET level = ${level} WHERE user_id = ${userId}`;
  return totalXp;
}

// Checks the given candidate badge codes against current user state and
// awards any newly-earned ones (idempotent via ON CONFLICT DO NOTHING).
// Returns the badges newly earned by this call (empty if none/all already
// held). Each candidate's XP bonus is applied via addXp before returning.
export async function checkAndAwardBadges(
  userId: string,
  candidateCodes: string[]
): Promise<Badge[]> {
  if (candidateCodes.length === 0) return [];

  const [stats, streak, workoutCount, completedChallenges, alreadyEarned, catalog] =
    await Promise.all([
      sql`SELECT total_xp, level, chat_turn_count FROM user_stats WHERE user_id = ${userId}`,
      sql`SELECT current_streak FROM user_streaks WHERE user_id = ${userId}`,
      sql`SELECT COUNT(*)::int AS count FROM workout_logs WHERE user_id = ${userId}`,
      sql`SELECT COUNT(*)::int AS count FROM challenges WHERE user_id = ${userId} AND status = 'completed'`,
      sql`SELECT badge_code FROM user_badges WHERE user_id = ${userId}`,
      sql`SELECT code, name, description, icon, xp_bonus FROM badge_catalog WHERE code = ANY(${candidateCodes})`,
    ]);

  const earnedCodes = new Set((alreadyEarned as { badge_code: string }[]).map((r) => r.badge_code));
  const s = stats[0] as { total_xp: number; level: number; chat_turn_count: number };
  const currentStreak = (streak[0]?.current_streak as number) ?? 0;
  const workouts = workoutCount[0].count as number;
  const completed = completedChallenges[0].count as number;

  const meetsCondition: Record<string, boolean> = {
    first_rep: workouts >= 1,
    workout_warrior_10: workouts >= 10,
    streak_3: currentStreak >= 3,
    streak_7: currentStreak >= 7,
    streak_30: currentStreak >= 30,
    first_challenge: completed >= 1,
    challenge_streak_3: completed >= 3,
    chatty_25: s.chat_turn_count >= 25,
    level_5: s.level >= 5,
  };

  const newlyEarned: Badge[] = [];
  for (const row of catalog as {
    code: string;
    name: string;
    description: string;
    icon: string | null;
    xp_bonus: number;
  }[]) {
    if (earnedCodes.has(row.code)) continue;
    if (!meetsCondition[row.code]) continue;

    const inserted = await sql`
      INSERT INTO user_badges (user_id, badge_code)
      VALUES (${userId}, ${row.code})
      ON CONFLICT (user_id, badge_code) DO NOTHING
      RETURNING badge_code
    `;
    if (inserted.length === 0) continue; // lost a race to another request

    if (row.xp_bonus > 0) await addXp(userId, row.xp_bonus);

    newlyEarned.push({
      code: row.code,
      name: row.name,
      description: row.description,
      icon: row.icon,
      xpBonus: row.xp_bonus,
    });
  }

  return newlyEarned;
}

const ALL_BADGE_CODES = [
  "first_rep",
  "workout_warrior_10",
  "streak_3",
  "streak_7",
  "streak_30",
  "first_challenge",
  "challenge_streak_3",
  "chatty_25",
  "level_5",
];

export type StreakResult = {
  dailyCheckInAwarded: boolean;
  streak: { current: number; longest: number };
  newBadges: Badge[];
};

// Evaluates and updates the user's daily streak based on server time (UTC
// calendar day — a documented v1 simplification, see workflows docs).
// Safe to call multiple times per day: only the first qualifying call of a
// given UTC day advances the streak and awards the check-in bonus.
export async function evaluateStreakAndCheckIn(userId: string): Promise<StreakResult> {
  const inserted = await sql`
    INSERT INTO daily_activity (user_id, activity_date)
    VALUES (${userId}, (now() AT TIME ZONE 'UTC')::date)
    ON CONFLICT DO NOTHING
    RETURNING activity_date
  `;

  if (inserted.length === 0) {
    const rows = await sql`
      SELECT current_streak, longest_streak FROM user_streaks WHERE user_id = ${userId}
    `;
    const row = rows[0] as { current_streak: number; longest_streak: number };
    return {
      dailyCheckInAwarded: false,
      streak: { current: row.current_streak, longest: row.longest_streak },
      newBadges: [],
    };
  }

  const today = inserted[0].activity_date as string;
  const rows = await sql`
    SELECT current_streak, longest_streak, last_check_in_date
    FROM user_streaks WHERE user_id = ${userId}
  `;
  const row = rows[0] as {
    current_streak: number;
    longest_streak: number;
    last_check_in_date: string | null;
  };

  let nextStreak: number;
  if (row.last_check_in_date === null) {
    nextStreak = 1;
  } else {
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    nextStreak = row.last_check_in_date === yesterdayStr ? row.current_streak + 1 : 1;
  }

  const nextLongest = Math.max(row.longest_streak, nextStreak);

  await sql`
    UPDATE user_streaks
    SET current_streak = ${nextStreak},
        longest_streak = ${nextLongest},
        last_check_in_date = ${today},
        updated_at = now()
    WHERE user_id = ${userId}
  `;

  await addXp(userId, XP.DAILY_CHECK_IN);
  const newBadges = await checkAndAwardBadges(userId, ["streak_3", "streak_7", "streak_30", "level_5"]);

  return {
    dailyCheckInAwarded: true,
    streak: { current: nextStreak, longest: nextLongest },
    newBadges,
  };
}

export async function awardChatTurnXp(userId: string): Promise<{ newBadges: Badge[] }> {
  await sql`
    UPDATE user_stats SET chat_turn_count = chat_turn_count + 1, updated_at = now()
    WHERE user_id = ${userId}
  `;
  await addXp(userId, XP.CHAT_TURN);
  const newBadges = await checkAndAwardBadges(userId, ["chatty_25", "level_5"]);
  return { newBadges };
}

export type WorkoutXpResult = {
  xpAwarded: number;
  newBadges: Badge[];
  completedChallenges: { id: string; title: string }[];
};

// Awards XP for a logged workout, then recomputes any active
// workout_logs-metric challenges for this user, completing any that have
// now hit their target (awarding challenge-completion XP + badges too).
export async function awardWorkoutXp(userId: string): Promise<WorkoutXpResult> {
  await addXp(userId, XP.WORKOUT_LOGGED);
  const workoutBadges = await checkAndAwardBadges(userId, [
    "first_rep",
    "workout_warrior_10",
    "level_5",
  ]);

  const activeChallenges = await sql`
    SELECT id, title, target_count FROM challenges
    WHERE user_id = ${userId} AND status = 'active' AND metric = 'workout_logs'
  `;

  const completedChallenges: { id: string; title: string }[] = [];
  const challengeBadgeCandidates = new Set<string>();

  for (const ch of activeChallenges as { id: string; title: string; target_count: number }[]) {
    const countRows = await sql`
      SELECT COUNT(*)::int AS count FROM workout_logs
      WHERE user_id = ${userId} AND performed_at >= (
        SELECT created_at FROM challenges WHERE id = ${ch.id}
      )
    `;
    const count = countRows[0].count as number;

    await sql`UPDATE challenges SET current_count = ${count} WHERE id = ${ch.id}`;

    if (count >= ch.target_count) {
      const flipped = await sql`
        UPDATE challenges SET status = 'completed', completed_at = now()
        WHERE id = ${ch.id} AND status = 'active'
        RETURNING id, title
      `;
      if (flipped.length > 0) {
        await addXp(userId, XP.CHALLENGE_COMPLETED);
        completedChallenges.push({ id: ch.id, title: ch.title });
        challengeBadgeCandidates.add("first_challenge");
        challengeBadgeCandidates.add("challenge_streak_3");
        challengeBadgeCandidates.add("level_5");
      }
    }
  }

  const challengeBadges =
    challengeBadgeCandidates.size > 0
      ? await checkAndAwardBadges(userId, [...challengeBadgeCandidates])
      : [];

  return {
    xpAwarded:
      XP.WORKOUT_LOGGED + completedChallenges.length * XP.CHALLENGE_COMPLETED,
    newBadges: [...workoutBadges, ...challengeBadges],
    completedChallenges,
  };
}

// Sweeps active challenges for a user: recomputes current_count and flips
// status to 'completed' (awarding XP/badges) or 'expired' as appropriate.
// Called opportunistically whenever gamification state is read.
export async function sweepChallenges(userId: string) {
  const active = await sql`
    SELECT id, title, target_count, metric, deadline, created_at FROM challenges
    WHERE user_id = ${userId} AND status = 'active'
  `;

  for (const ch of active as {
    id: string;
    title: string;
    target_count: number;
    metric: string;
    deadline: string;
    created_at: string;
  }[]) {
    if (ch.metric !== "workout_logs") continue;

    const countRows = await sql`
      SELECT COUNT(*)::int AS count FROM workout_logs
      WHERE user_id = ${userId} AND performed_at >= ${ch.created_at}
    `;
    const count = countRows[0].count as number;
    await sql`UPDATE challenges SET current_count = ${count} WHERE id = ${ch.id}`;

    if (count >= ch.target_count) {
      const flipped = await sql`
        UPDATE challenges SET status = 'completed', completed_at = now()
        WHERE id = ${ch.id} AND status = 'active'
        RETURNING id
      `;
      if (flipped.length > 0) {
        await addXp(userId, XP.CHALLENGE_COMPLETED);
        await checkAndAwardBadges(userId, ["first_challenge", "challenge_streak_3", "level_5"]);
      }
    } else if (new Date(ch.deadline) < new Date()) {
      await sql`
        UPDATE challenges SET status = 'expired' WHERE id = ${ch.id} AND status = 'active'
      `;
    }
  }
}

export { ALL_BADGE_CODES };
