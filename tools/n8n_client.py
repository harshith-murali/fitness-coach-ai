"""Thin REST fallback for the n8n Public API.

Use the n8n MCP server first for anything it exposes (inspecting/editing
workflows, node lookups). Reach for this only for what the MCP server
doesn't cover, e.g. bulk scripted checks across many workflows.

Config comes from the repo-root .env: N8N_API_URL, N8N_API_KEY.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import requests


def _load_env() -> None:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_env()


class N8nClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = (base_url or os.environ.get("N8N_API_URL", "")).rstrip("/")
        self.api_key = api_key or os.environ.get("N8N_API_KEY", "")
        if not self.base_url or not self.api_key:
            raise RuntimeError(
                "N8N_API_URL and N8N_API_KEY must be set in the repo-root .env "
                "to use n8n_client.py"
            )
        self._session = requests.Session()
        self._session.headers.update(
            {"X-N8N-API-KEY": self.api_key, "Accept": "application/json"}
        )

    def _url(self, path: str) -> str:
        return f"{self.base_url}/api/v1/{path.lstrip('/')}"

    def list_workflows(self, active: bool | None = None) -> list[dict[str, Any]]:
        params = {}
        if active is not None:
            params["active"] = str(active).lower()
        resp = self._session.get(self._url("workflows"), params=params, timeout=30)
        resp.raise_for_status()
        return resp.json().get("data", [])

    def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        resp = self._session.get(self._url(f"workflows/{workflow_id}"), timeout=30)
        resp.raise_for_status()
        return resp.json()

    def set_active(self, workflow_id: str, active: bool) -> dict[str, Any]:
        path = f"workflows/{workflow_id}/{'activate' if active else 'deactivate'}"
        resp = self._session.post(self._url(path), timeout=30)
        resp.raise_for_status()
        return resp.json()

    def list_executions(
        self, workflow_id: str | None = None, limit: int = 20
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if workflow_id:
            params["workflowId"] = workflow_id
        resp = self._session.get(self._url("executions"), params=params, timeout=30)
        resp.raise_for_status()
        return resp.json().get("data", [])


if __name__ == "__main__":
    client = N8nClient()
    for wf in client.list_workflows():
        status = "active" if wf.get("active") else "inactive"
        print(f"{wf['id']}  {status:9s}  {wf['name']}")
