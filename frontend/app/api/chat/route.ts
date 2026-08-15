import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { awardChatTurnXp, evaluateStreakAndCheckIn } from "@/lib/gamification";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// n8n's Chat Trigger node expects { chatInput, sessionId } and, with the
// default "Respond with last node's output" setting on a chat-triggered
// agent, replies with { output: string }. UNVERIFIED against the live
// workflow — confirm the real request/response shape with
// tools/test_webhook.py once the workflow has a trigger URL, and update
// this route if the actual shape differs (see workflows/validate_workflow.md).
//
// anonUserId is also forwarded to n8n so the AI Agent's create_challenge
// Tool node can attach challenges to the right user (see
// workflows/validate_workflow.md for the Tool node contract).
export async function POST(request: NextRequest) {
  const webhookUrl = process.env.N8N_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "N8N_CHAT_WEBHOOK_URL is not configured" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { chatInput, sessionId, anonUserId } =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  if (typeof chatInput !== "string" || chatInput.trim() === "") {
    return NextResponse.json(
      { error: "Missing required field: chatInput" },
      { status: 400 }
    );
  }

  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    return NextResponse.json(
      { error: "Missing required field: sessionId" },
      { status: 400 }
    );
  }

  const validAnonUserId =
    typeof anonUserId === "string" && UUID_RE.test(anonUserId) ? anonUserId : null;

  let n8nResponse: Response;
  try {
    n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatInput, sessionId, anonUserId: validAnonUserId }),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the fitness coach. Please try again." },
      { status: 502 }
    );
  }

  const rawBody = await n8nResponse.text();
  let data: unknown;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  if (!data || typeof data !== "object") {
    return NextResponse.json(
      { error: "The fitness coach returned an unexpected response. Please try again." },
      { status: n8nResponse.ok ? 502 : n8nResponse.status }
    );
  }

  // Gamification side effects never block or fail the chat response —
  // if identity isn't bootstrapped yet, or a DB call errors, chat still works.
  if (n8nResponse.ok && validAnonUserId) {
    try {
      const userRows = await sql`SELECT id FROM users WHERE id = ${validAnonUserId}`;
      if (userRows.length > 0) {
        await awardChatTurnXp(validAnonUserId);
        await evaluateStreakAndCheckIn(validAnonUserId);
      }
    } catch (err) {
      console.error("Gamification side effect failed for chat turn:", err);
    }
  }

  return NextResponse.json(data, { status: n8nResponse.status });
}
