"""Fire a real test payload at an n8n workflow's webhook URL and inspect
the actual HTTP response — status, JSON shape, error case.

This is the live round-trip check required by CLAUDE.md before a workflow
can be marked "ready": static shape checks via the n8n MCP server are not
sufficient on their own.

Usage:
    python tools/test_webhook.py <webhook-url> --json '{"key": "value"}'

Example for the Fitness Coach workflow (n8n Chat Trigger node — payload
shape is chatInput/sessionId; confirm the real shape once the workflow is
live, this is a starting guess based on n8n's default Chat Trigger):
    python tools/test_webhook.py \\
        https://harshith1103.app.n8n.cloud/webhook/<id>/chat \\
        --json '{"chatInput": "What is a good beginner leg day?", "sessionId": "test-session-1"}'
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import requests


def fire(url: str, payload: dict, method: str = "POST", timeout: int = 60) -> None:
    print(f"--> {method} {url}")
    print(f"    payload: {json.dumps(payload)}")
    start = time.monotonic()
    try:
        resp = requests.request(method, url, json=payload, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        elapsed = time.monotonic() - start
        print(f"<-- FAILED after {elapsed:.2f}s: {exc}")
        sys.exit(1)

    elapsed = time.monotonic() - start
    print(f"<-- {resp.status_code} in {elapsed:.2f}s")
    print(f"    content-type: {resp.headers.get('content-type', '<none>')}")

    try:
        body = resp.json()
        print("    body (json):")
        print(json.dumps(body, indent=2)[:4000])
    except ValueError:
        print("    body (raw, not JSON):")
        print(resp.text[:2000])

    if not resp.ok:
        print(f"\nFAIL: non-2xx status {resp.status_code}")
        sys.exit(1)

    print("\nOK: got a response back from the webhook.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", help="Full webhook URL (production or -test)")
    parser.add_argument(
        "--json",
        dest="json_payload",
        default="{}",
        help="JSON string to send as the request body",
    )
    parser.add_argument(
        "--method", default="POST", help="HTTP method (default: POST)"
    )
    parser.add_argument(
        "--timeout", type=int, default=60, help="Request timeout in seconds"
    )
    args = parser.parse_args()

    try:
        payload = json.loads(args.json_payload)
    except json.JSONDecodeError as exc:
        print(f"Invalid --json payload: {exc}")
        sys.exit(1)

    fire(args.url, payload, method=args.method, timeout=args.timeout)


if __name__ == "__main__":
    main()
