"""Pre-dispatch Identity Kernel guard for the public Leonardo web ACP profile.

This plugin runs inside the Hermes ACP subprocess before model_tools.registry.dispatch.
It is deliberately narrower than the route-level receipt gate: the route still
emits the passport-bound Identity Kernel receipt, while this hook prevents the
Hermes web profile from executing host tools that are outside the current beta
passport authority surface.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional

# Public beta passport 6960 grants answer/search/summarize. The route-level
# Identity Kernel maps search_graph/browser specially; the web ACP profile should
# only execute the graph/council read tools here. Generic web/vision/browser host
# tools remain outside this passport authority until the passport document/route
# carries an explicit live grant.
_ALLOWED_TOOLS = {
    "search_graph",
    "graph_concept",
    "graph_related",
    "graph_bible",
    "scripture_reference",
    "council_memory",
    "search_council_memory",
}

# Some ACP/MCP adapters prefix tool names; accept exact graph/council suffixes
# but keep generic host tools such as web_search/web_extract/vision_analyze out.
_ALLOWED_SUFFIXES = tuple(f"__{name}" for name in _ALLOWED_TOOLS) + tuple(f".{name}" for name in _ALLOWED_TOOLS)


def _is_allowed(tool_name: str) -> bool:
    name = str(tool_name or "").strip()
    if not name:
        return False
    if name in _ALLOWED_TOOLS:
        return True
    return name.endswith(_ALLOWED_SUFFIXES)


def _current_request_id() -> Optional[str]:
    path = os.environ.get("LEO_WEB_TOOL_GUARD_CONTEXT")
    if not path:
        return None
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None
    request_id = data.get("request_id") if isinstance(data, dict) else None
    return request_id if isinstance(request_id, str) and request_id else None


def _record_blocked_tool(tool_name: str) -> None:
    path = os.environ.get("LEO_WEB_TOOL_GUARD_EVENTS")
    if not path:
        return
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "event": "blocked_tool",
                "tool_name": tool_name,
                "request_id": _current_request_id(),
                "ts": time.time(),
            }, ensure_ascii=False) + "\n")
    except Exception:
        return


def _on_pre_tool_call(tool_name: str = "", args: Optional[dict[str, Any]] = None, **_: Any) -> Optional[dict[str, str]]:
    if os.environ.get("LEO_WEB_IDENTITY_TOOL_GUARD", "1") in {"0", "false", "False", "off"}:
        return None
    name = str(tool_name or "").strip()
    if _is_allowed(name):
        return None
    _record_blocked_tool(name or "unknown tool")
    print(f"[leo-web-identity-tool-guard] blocked pre-dispatch tool: {name or '?'}", file=sys.stderr, flush=True)
    return {
        "action": "block",
        "message": f"Identity Kernel web-profile guard blocked {name or 'unknown tool'} before dispatch: outside installed passport authority scope.",
    }


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
