"""Read-only graph + council MCP for the Leonardo web agent.

Exposes the imagination graph (via the existing workshop sidecar REST) and the
council-memory log as MCP tools. ALL reads — no writes, no shell, no Neo4j creds
here. This is what the gateway passes to the Hermes ACP `session/new` so the real
Leonardo agent can cite the graph in a sandboxed, web-safe session.

Launched by the ACP agent as a stdio MCP subprocess. Run with the hermes venv
(has `mcp` + `httpx`):

    /home/exor/.hermes/hermes-agent/venv/bin/python services/graph-mcp/server.py

Env:
  WORKSHOP_SIDECAR_URL   default http://127.0.0.1:8799
  COUNCIL_MEMORY_LOG     default ~/.leonardo-platform/council-memory/log.json
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

# stdout is the MCP JSON-RPC transport — keep it protocol-only. Route all logging
# to stderr and silence httpx's per-request INFO chatter so it can't corrupt it.
logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logging.getLogger("httpx").setLevel(logging.WARNING)

SIDECAR = os.environ.get("WORKSHOP_SIDECAR_URL", "http://127.0.0.1:8799").rstrip("/")

mcp = FastMCP("leonardo-graph")


def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        r = httpx.post(f"{SIDECAR}{path}", json=payload, timeout=60.0)
        r.raise_for_status()
        return r.json()
    except Exception as e:  # honest failure — never fabricate graph data
        return {"ok": False, "error": f"graph unavailable: {str(e)[:200]}"}


@mcp.tool()
def search_graph(query: str) -> dict[str, Any]:
    """Search the imagination graph (~577k concepts mined from fiction, myth, and
    sacred text) by keyword. Returns ranked concept candidates. Your entry point
    for discovery — then deep-dive a hit with graph_concept."""
    return _post("/graph/search", {"name": query})


@mcp.tool()
def graph_concept(name: str) -> dict[str, Any]:
    """Deep-dive a named concept: its real provenance — author, work, year, and the
    actual passage (excerpt) that imagined it. Use to ground a claim in a citable
    source. Resolves fuzzy names, so it also works as a direct lookup."""
    return _post("/graph/concept", {"name": name})


@mcp.tool()
def graph_related(name: str) -> dict[str, Any]:
    """Concepts that co-occur with this one in the same source passages — adjacent
    prior art and links. Use to widen from a concept."""
    return _post("/graph/related", {"name": name})


@mcp.tool()
def graph_bible(name: str) -> dict[str, Any]:
    """Bible parallels for a concept: capacities, symbols, verses from the
    scriptural knowledge graph. Use when a concept has a mythic/sacred lineage."""
    return _post("/graph/bible", {"name": name})


@mcp.tool()
def council_memory(query: str, limit: int = 5) -> dict[str, Any]:
    """Recall what the Council has ACTUALLY deliberated — real past verdicts,
    rulings, and proof chains from the Council's own memory graph. Use this to
    answer questions about what concepts the Council has worked on and what it
    decided. Check it before suggesting a fresh (paid) Council panel — if they
    already ruled on something close, cite it instead."""
    # Semantic recall against the real Council memory graph, via the sidecar.
    res = _post("/council/search", {"query": query, "limit": limit})
    if not res.get("ok"):
        return res
    hits = []
    for h in res.get("hits", []):
        hits.append({
            "seat": h.get("seat", ""),
            "status": h.get("status"),          # e.g. "VERIFIED / PASS_TO_BUILD"
            "ruling": h.get("snippet", ""),     # the claim text (proof, objections, checks)
            "when": h.get("created_at"),
        })
    return {"ok": True, "hits": hits}


if __name__ == "__main__":
    mcp.run()
