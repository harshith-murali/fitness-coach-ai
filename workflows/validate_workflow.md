# Validate: Fitness Coach

## Status: SHIPPED — chat coaching live and verified. create_challenge tool deferred (n8n instance bug).

## What it is (as actually built in n8n, workflow id `ptA1dM7cKD2Vi7Ew`)

`When chat message received` (Chat Trigger, mode `webhook`, `responseMode:
lastNode`, public/no auth) → `AI Agent` ("Fitness Coach" system prompt) with:
- **Model**: OpenAI `gpt-5-mini` (kept the existing working credential
  instead of the originally-planned OpenRouter)
- **Memory**: `Simple Memory` (buffer window, session ID from input,
  10-message context window) — cross-turn memory confirmed working live.
- **Tool**: none currently. `create_challenge` was attempted twice (see
  "What broke" below) and removed after both attempts failed with what
  appear to be n8n-instance-level bugs, not configuration mistakes. The
  agent still proposes challenges to the user in plain conversational text
  (per its system prompt) — it just can't register them via a tool call yet.

Production webhook URL:
`https://harshith1103.app.n8n.cloud/webhook/2a2548b2-d025-430a-b148-2bb9c7b5f29a/chat`

## Static shape check — PASSED

1. **Trigger**: Chat Trigger, public, no auth, `responseMode: lastNode`.
2. **Chat Model**: OpenAI `gpt-5-mini`, credential `n8n free OpenAI API
   credits`, connected to the Agent's `ai_languageModel` input.
3. **Memory**: `Simple Memory` connected to `ai_memory`, session ID sourced
   from the trigger's `sessionId` field.
4. **Response shape**: confirmed live — `{ "output": "<agent reply>" }`,
   matching `frontend/app/api/chat/route.ts` and `frontend/app/page.tsx`.

## Live round-trip test — PASSED (chat + memory)

```bash
python tools/test_webhook.py \
  https://harshith1103.app.n8n.cloud/webhook/2a2548b2-d025-430a-b148-2bb9c7b5f29a/chat \
  --json '{"chatInput": "Give me one quick tip for better squat form.", "sessionId": "final-verify-1", "anonUserId": "55555555-5555-5555-5555-555555555555"}'
```

Result: `200`, body `{"output": "<coaching reply, includes a plain-text
challenge suggestion>"}` in ~11s. Also confirmed live against the deployed
frontend directly:

```bash
curl -X POST https://fitness-coach-ai-omega.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"chatInput": "...", "sessionId": "...", "anonUserId": "..."}'
```
→ `200 {"output": "Hello!"}` — confirms the full path frontend → n8n → OpenAI
→ back works end-to-end in production, not just against the raw webhook.

Second call, same `sessionId`, prompt `"What did I just ask you for?"` →
agent correctly recalled the prior turn. Memory confirmed working.

## What broke — create_challenge tool (documented so it isn't re-attempted blindly)

**Attempt 1 — `@n8n/n8n-nodes-langchain.toolHttpRequest`** (the standard,
recommended HTTP Request Tool node for agent tools): configured correctly
per the node's schema (validated statically with `validate_node_config`),
but every live tool call failed with:
```
The node "@n8n/n8n-nodes-langchain.toolHttpRequest" has a "supplyData"
method but no "execute" method.
```
This happened on **7 consecutive tool-call attempts** within one agent run
(the agent kept retrying), never once succeeding. This is not a config
error — it's the node's own runtime dispatch failing on this n8n instance,
implying a broken/mismatched install of the `@n8n/n8n-nodes-langchain`
package.

Also separately learned along the way: `{{ $env.APP_BASE_URL }}` cannot be
used in *any* node parameter on this instance — env var access is blocked
instance-wide (`N8N_BLOCK_ENV_ACCESS_IN_NODE`), and referencing it crashes
the whole agent call at tool-list-preparation time, not just the one tool.
The node's URL was hardcoded to the real deployed URL instead, once the
frontend was live: `https://fitness-coach-ai-omega.vercel.app/api/challenges`.

**Attempt 2 — `@n8n/n8n-nodes-langchain.toolCode`** (Code Tool, JS,
`this.helpers.httpRequest(...)` inside, with a manual JSON input schema):
statically valid, but live calls failed with `query.toUpperCase is not a
function [line 2]` — an error thrown from n8n's own internal tool-input
handling before the node's own code body runs (the code has no
`.toUpperCase()` call anywhere), again pointing at the same
langchain-nodes-package issue rather than a mistake in the tool code itself.

**Not tried**: `n8n-nodes-base.httpRequest` used directly as a tool — the
`update_workflow` API itself rejects this at the connection level
("its node type does not produce an 'ai_tool' output"), so it can't be wired
as an agent tool at all through this path, regardless of the instance bug.

**Decision**: rather than keep guessing at workarounds for what looks like a
platform-level bug, `create_challenge` was removed from the workflow. The
agent's system prompt was updated to describe challenges in plain
conversational text instead of calling a tool. The chat/coaching path — the
core of the product — is fully live and verified.

## To revisit create_challenge later

1. Check whether the n8n instance/`@n8n/n8n-nodes-langchain` package can be
   updated (this looks like a version-skew bug: the node type has a
   `supplyData` method registered but its `execute` method isn't wired up
   in the installed build).
2. If updating isn't possible, consider `@n8n/n8n-nodes-langchain.toolWorkflow`
   (Execute Workflow Tool, calling a small sub-workflow that does the HTTP
   call via a plain `n8n-nodes-base.httpRequest` node, not as a tool
   subnode) — untested here, but it routes through a different code path
   (sub-workflow execution rather than in-agent tool dispatch) and might
   avoid whatever is broken in direct tool-subnode dispatch.
3. Once a working approach is found, re-add the tool pointed at
   `https://fitness-coach-ai-omega.vercel.app/api/challenges`, re-publish,
   and re-run the live test with a prompt designed to trigger it — confirm
   the resulting row via `mcp__Neon__run_sql` against project
   `fragrant-cake-70976363`.

## Status of the rest of the app (gamification)

Built and verified independently against the live Neon database (project
`fragrant-cake-70976363`) — see `n8n-app/fitness-coach/CLAUDE.md`. The chat
path (XP for chat turns, streak evaluation) is now live end-to-end through
the deployed frontend, not just the raw webhook.
