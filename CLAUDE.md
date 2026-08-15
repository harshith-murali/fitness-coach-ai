# Fitness Coach — App Instructions

This app follows the same **WAT framework** (Workflows, Agents, Tools) and
hard constraints defined in the parent [`n8n-app/CLAUDE.md`](../CLAUDE.md).
Read that file first — this one only covers what's specific to this app.

## Status: GAMIFICATION BUILT & VERIFIED / N8N CHAT PATH VERIFIED / create_challenge TOOL NOT YET REACHABLE

The gamification system (Neon Postgres, XP/levels, streaks, badges, nickname
leaderboard, workout logging, coach-assigned challenges) is fully built and
was smoke-tested end-to-end against the live database — see "Gamification
system" below.

The n8n workflow ("Fitness Coach", id `ptA1dM7cKD2Vi7Ew`) is live and
published: Chat Trigger → AI Agent (OpenAI `gpt-5-mini`) → response, with
Simple Memory wired for cross-turn recall. Both the static shape check and a
live round-trip test (including a memory-continuity check) passed — see
`workflows/validate_workflow.md` for the full record, including a bug that
was found and fixed (env var access is blocked on this n8n instance, which
broke every chat turn until fixed). `N8N_CHAT_WEBHOOK_URL` is set in
`frontend/.env.local` to the real production webhook URL.

**Still open**: the `create_challenge` Tool node points at a placeholder
URL (`https://REPLACE_WITH_DEPLOYED_APP_URL/api/challenges`) because no
frontend deployment exists yet to give it a real target. Per the parent
CLAUDE.md's hard constraint, **do not treat challenge-creation-via-chat as
ready** until that URL is updated to a real reachable deployment and
re-tested (steps in `workflows/validate_workflow.md`). The chat/coaching
path itself is ready to build/test the frontend against now.

## What's different from the root `n8n-app/frontend` app

- **Trigger type**: this workflow uses n8n's **Chat Trigger** ("When chat
  message received"), not a generic `Webhook` node. That means the
  request/response contract is chat-shaped (`chatInput` / `sessionId` in,
  an agent reply out) rather than an arbitrary JSON contract designed
  per-workflow.
- **UI**: a conversational chat interface (message list + input box), not a
  single-shot form. See `frontend/app/page.tsx`.
- **Response shape**: `frontend/app/api/chat/route.ts` assumes the workflow
  responds with `{ "output": "<reply text>" }` — **confirmed correct**
  against the live workflow (see `workflows/validate_workflow.md`).
- **Memory**: a `Simple Memory` (buffer window, 10-message context) node is
  connected to the agent, keyed on the `sessionId` the frontend already
  sends. Cross-turn recall confirmed live.

## Gamification system

Anonymous, no-login identity (`anonUserId`, a client-generated UUID
persisted in `localStorage`, distinct from the per-page-load `sessionId`
used for n8n conversation correlation). All state lives in a dedicated Neon
Postgres project (`fitness-coach`, project id `fragrant-cake-70976363`).

- **XP/levels**: `frontend/lib/gamification.ts` — level formula
  `100*(L-1)^2 + 100*(L-1)` cumulative XP; chat turn = 5 XP, daily check-in =
  20 XP, workout logged = 25 XP, challenge completed = 75 XP, badge bonuses
  per `badge_catalog`.
- **Streaks**: UTC-calendar-day boundary (documented v1 simplification — see
  code comments in `evaluateStreakAndCheckIn`). Qualifying activity = a
  successful chat turn or a logged workout. Duolingo-style: breaks and
  restarts at 1 if a UTC day is skipped.
- **Badges**: 9 starter badges seeded in `badge_catalog` (first_rep,
  workout_warrior_10, streak_3/7/30, first_challenge, challenge_streak_3,
  chatty_25, level_5). Checked and awarded idempotently after every relevant
  write.
- **Leaderboard**: nickname-only, ranked by total XP, no auth. `GET
  /api/leaderboard`.
- **Workout logging**: explicit UI form (`POST /api/workouts`), not parsed
  from chat text.
- **Coach-assigned challenges**: created via `POST /api/challenges`, the
  callback target for an n8n Tool node the AI Agent calls mid-conversation
  (not yet wired in n8n — see `workflows/validate_workflow.md`). Progress is
  always derived from `workout_logs`, never client-settable; swept on every
  `GET /api/gamification/state` read.

All of the above was smoke-tested end-to-end against the live Neon database
(identity bootstrap, workout logging → XP/streak/badge awards, challenge
creation → completion → badge/XP award, leaderboard ranking, error paths for
missing/malformed/unknown identity). `npm run build` passes cleanly.

## File Structure

```
fitness-coach/
  CLAUDE.md                      # this file
  frontend/                      # Next.js + React chat UI
    app/page.tsx                   # chat UI + gamification bar/leaderboard/workout form
    app/api/chat/route.ts          # proxies to N8N_CHAT_WEBHOOK_URL, awards chat-turn XP/streak
    app/api/identity/route.ts      # bootstrap/update anonymous user + nickname
    app/api/gamification/state/route.ts  # XP/level/streak/badges/active challenges
    app/api/workouts/route.ts      # log a workout, awards XP/streak/badges/challenge progress
    app/api/leaderboard/route.ts   # nickname leaderboard ranked by XP
    app/api/challenges/route.ts    # n8n Tool callback: create a challenge
    app/api/challenges/[id]/route.ts  # fetch single challenge w/ recomputed progress
    lib/gamification.ts            # XP/level formula, streak eval, badge checks (shared logic)
    lib/db.ts                      # Neon connection helper
    lib/identity.ts                 # x-anon-id header validation helpers
    .env.local                     # N8N_CHAT_WEBHOOK_URL (unset), DATABASE_URL (set)
  tools/
    n8n_client.py                  # thin REST fallback (same as root app)
    test_webhook.py                 # live round-trip test against the chat webhook
  workflows/
    validate_workflow.md            # SOP: what "ready" means for this workflow, how to check
```

## Next steps (in order)

1. `npm install && npm run dev` inside `frontend/`, test the chat loop
   locally end-to-end against the now-live webhook (nickname prompt → chat →
   XP/streak awarding → workout log → leaderboard), including the error case
   (a bad/unreachable webhook URL should show a real error, not a silent
   hang — `app/api/chat/route.ts` already handles this).
2. Decide on a deployment target for this subfolder (new Vercel project, or
   a path added to the existing `n8n-app/frontend` deployment — ask the
   user, don't assume) and deploy it.
3. Once deployed, update the `create_challenge` Tool node's URL (currently
   `https://REPLACE_WITH_DEPLOYED_APP_URL/api/challenges`) to the real
   deployed URL via n8n MCP `update_workflow` (`setNodeParameter`, path
   `/url`), then `publish_workflow` again.
4. Send a prompt designed to make the agent propose a challenge (e.g. "give
   me a week-long pushup challenge"), confirm the resulting row appears via
   `mcp__Neon__run_sql` against project `fragrant-cake-70976363`. This is
   the one remaining unverified piece — see `workflows/validate_workflow.md`.
5. Set `DATABASE_URL` and `N8N_CHAT_WEBHOOK_URL` as real environment
   variables in the deployment, not just `.env.local`.
