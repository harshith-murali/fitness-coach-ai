# Validate: Fitness Coach

## Status: CHAT PATH VERIFIED — create_challenge tool NOT reachable yet (no deployed app URL)

## What it is (as actually built in n8n, workflow id `ptA1dM7cKD2Vi7Ew`)

`When chat message received` (Chat Trigger, mode `webhook`, `responseMode:
lastNode`, public/no auth) → `AI Agent` ("Fitness Coach" system prompt) with:
- **Model**: OpenAI `gpt-5-mini` (kept the existing working credential
  instead of the originally-planned OpenRouter — no functional difference
  for this workflow, avoided a redundant credential setup)
- **Memory**: `Simple Memory` (buffer window, session ID from input,
  10-message context window) — cross-turn memory **is** wired up, contrary
  to the earlier "not verified" draft of this doc
- **Tool**: `create_challenge`, an HTTP Request Tool node — wired but not
  yet reachable (see below)

Production webhook URL:
`https://harshith1103.app.n8n.cloud/webhook/2a2548b2-d025-430a-b148-2bb9c7b5f29a/chat`

## Static shape check — PASSED

1. **Trigger**: Chat Trigger, public, no auth, `responseMode: lastNode`
   (the last-executed node — the AI Agent — must emit `{ output: string }`;
   confirmed live, see below).
2. **Chat Model**: OpenAI `gpt-5-mini`, credential `n8n free OpenAI API
   credits`, connected to the Agent's `ai_languageModel` input. Valid.
3. **Memory**: `Simple Memory` node connected to the Agent's `ai_memory`
   input, session ID sourced from the trigger's `sessionId` field. Wired.
4. **Tool — `create_challenge`**: HTTP Request Tool node connected to the
   Agent's `ai_tool` input. POST, JSON body:
   `{ anonUserId, title, targetCount, durationDays }`, `anonUserId` pulled
   from `{{ $('When chat message received').item.json.anonUserId }}`.
   **Known limitation**: this n8n instance has environment-variable access
   blocked in nodes (`N8N_BLOCK_ENV_ACCESS_IN_NODE` — confirmed via a live
   execution error, "access to env vars denied", which crashed the *entire*
   agent call, not just the tool, because env vars are resolved at node-init
   time). `{{ $env.APP_BASE_URL }}` cannot be used here. The URL field
   currently holds a placeholder:
   `https://REPLACE_WITH_DEPLOYED_APP_URL/api/challenges` — **must be
   updated to the real deployed frontend URL before this tool will work.**
   Until then, if the agent tries to call `create_challenge` it will fail
   (though it will fail as a tool-call error the agent can report, not a
   whole-request crash, since env-var resolution isn't in the path anymore).
5. **Response shape**: confirmed live — `{ "output": "<agent reply>" }`,
   matching what `frontend/app/api/chat/route.ts` and `frontend/app/page.tsx`
   already assume. No frontend changes needed.

## Live round-trip test — PASSED (chat + memory), NOT TESTED (create_challenge)

```bash
python tools/test_webhook.py \
  https://harshith1103.app.n8n.cloud/webhook/2a2548b2-d025-430a-b148-2bb9c7b5f29a/chat \
  --json '{"chatInput": "Give me a simple 3-day beginner workout split.", "sessionId": "test-session-1", "anonUserId": "11111111-1111-1111-1111-111111111111"}'
```

Result: `200`, body `{"output": "<full workout plan>"}`.

Second call, same `sessionId`, prompt `"What did I just ask you for?"` →
agent correctly recalled the prior turn. Memory confirmed working.

**What broke on the first attempt (fixed, documented so it isn't
rediscovered)**: the workflow returned `500 {"message": "Error in
workflow"}` on the very first live call. The actual n8n execution log (not
just the HTTP status) showed the real cause: `create_challenge`'s URL used
`{{ $env.APP_BASE_URL }}`, and this instance blocks env var access inside
nodes. That error occurs while the Agent is *preparing* its tool list
(`getConnectedTools`), before any tool is actually invoked by the LLM — so
it crashed every single chat turn, not just ones where the agent tried to
propose a challenge. Fix: replaced the `$env` expression with a plain
placeholder URL string. Lesson: never use `$env` inside a Tool node's
parameters on this instance; if `APP_BASE_URL` needs to vary per
environment, set it as a **workflow-level static value or hardcode per
environment at deploy time**, not via `$env`.

**Not yet tested**: a prompt that makes the agent actually call
`create_challenge` — pointless until the URL points at a real, reachable
deployment. Do this once the frontend is deployed:

1. Set the `create_challenge` node's URL to the real deployed
   `.../api/challenges` endpoint (via n8n MCP `update_workflow` →
   `setNodeParameter`, path `/url`).
2. Re-publish the workflow (`publish_workflow`).
3. Send a prompt designed to trigger a challenge proposal, e.g. "Give me a
   week-long pushup challenge."
4. Confirm the resulting row appears via `mcp__Neon__run_sql` against
   project `fragrant-cake-70976363`.

## Once the create_challenge check above passes

1. Remove the "NOT VERIFIED" / "NOT reachable" caveats from this file and
   `n8n-app/fitness-coach/CLAUDE.md`.
2. Only then treat the app as fully ready to deploy per the parent's deploy
   SOP.

## Status of the rest of the app (gamification)

Unchanged from before — built and verified independently against the live
Neon database (project `fragrant-cake-70976363`). See
`n8n-app/fitness-coach/CLAUDE.md` for details. The chat path (XP for chat
turns, streak evaluation) can now be tested for real since the webhook is
live — this hasn't been re-verified end-to-end through the actual frontend
UI yet (only the raw webhook was tested here, not `npm run dev` +
browser). That's the next step, per `CLAUDE.md`'s "Next steps".
