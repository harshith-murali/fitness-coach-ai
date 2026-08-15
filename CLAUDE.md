# Fitness Coach — App Instructions

This app follows the same **WAT framework** (Workflows, Agents, Tools) and
hard constraints defined in the parent [`n8n-app/CLAUDE.md`](../CLAUDE.md).
Read that file first — this one only covers what's specific to this app.

## Status: LIVE IN PRODUCTION — chat coaching fully shipped. create_challenge tool deferred (n8n platform bug, not a config issue).

- **Repo**: https://github.com/harshith-murali/fitness-coach-ai (standalone
  repo, separate from the parent `n8n-app` repo — this app is git-independent)
- **Live app**: https://fitness-coach-ai-omega.vercel.app
- **n8n workflow**: "Fitness Coach", id `ptA1dM7cKD2Vi7Ew`, published and
  live at `https://harshith1103.app.n8n.cloud/webhook/2a2548b2-d025-430a-b148-2bb9c7b5f29a/chat`

The gamification system (Neon Postgres, XP/levels, streaks, badges, nickname
leaderboard, workout logging) is fully built and smoke-tested end-to-end
against the live database — see "Gamification system" below.

The n8n workflow is live and published: Chat Trigger → AI Agent (OpenAI
`gpt-5-mini`) → response, with Simple Memory wired for cross-turn recall.
Verified end-to-end in production, not just the raw webhook: a `curl` against
the deployed frontend's `/api/chat` route returned a correct agent reply.
Full history of what was checked and fixed along the way (env var access
being blocked on this n8n instance, a wrong env var name/value in Vercel,
etc.) is in `workflows/validate_workflow.md`.

**Deferred**: `create_challenge` (a tool letting the agent register a
structured challenge mid-conversation) was attempted with two different n8n
tool node types; both failed at live-execution time with what look like bugs
in this n8n instance's `@n8n/n8n-nodes-langchain` package install (not
configuration mistakes — see `workflows/validate_workflow.md`, "What broke",
for the exact errors and what was ruled out). Removed from the workflow
rather than ship a tool guaranteed to fail. The agent still proposes
challenges to the user in plain text per its system prompt — it just doesn't
register them as structured DB rows yet. Revisit per the steps in
`workflows/validate_workflow.md` when there's appetite to debug the n8n
instance itself.

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

Everything through "verified live in production" is done. What's left:

1. **Revisit `create_challenge`** — see `workflows/validate_workflow.md`
   "To revisit create_challenge later" for the leading candidate
   (`toolWorkflow` / Execute Workflow Tool routing through a sub-workflow,
   untested) and what's already been ruled out. Not urgent; the product
   works without it.
2. Browser-test the full user loop against the live deployment (nickname
   prompt → chat → XP/streak awarding → workout log → leaderboard), not just
   the API routes via curl — `npm run dev` locally against the live
   `N8N_CHAT_WEBHOOK_URL`, or directly against
   https://fitness-coach-ai-omega.vercel.app.
3. If traffic grows, consider whether the `gpt-5-mini` credential ("n8n free
   OpenAI API credits") has rate/usage limits worth watching.
