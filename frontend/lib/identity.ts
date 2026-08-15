import { NextRequest, NextResponse } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireAnonId(request: NextRequest): string | NextResponse {
  const anonId = request.headers.get("x-anon-id");
  if (!anonId || !UUID_RE.test(anonId)) {
    return NextResponse.json({ error: "Missing or invalid identity" }, { status: 401 });
  }
  return anonId;
}

export function optionalAnonId(request: NextRequest): string | null {
  const anonId = request.headers.get("x-anon-id");
  return anonId && UUID_RE.test(anonId) ? anonId : null;
}
