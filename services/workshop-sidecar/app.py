"""Workshop sidecar: HTTP wrapper around Leonardo's research workflow.

Runs inside the Leonardo venv (it imports leonardo.*):

    cd ~/Leonardo && .venv/bin/python -m uvicorn app:app \
        --app-dir ~/leonardo-platform/services/workshop-sidecar --port 8799

Two modes on POST /research:
  {"canon_id": "CANON-01v2-0001"}  -> the real canon workflow (writes a brief file)
  {"topic": "memory palace"}       -> ad-hoc entry through the same evidence
                                      pipeline (graph + bible + semantic + cached web)

Local-only service: bind 127.0.0.1; the gateway is the only caller.
"""
from __future__ import annotations

import os
import sys
from dataclasses import asdict
from typing import Any

LEONARDO_ROOT = os.environ.get("LEONARDO_ROOT", os.path.expanduser("~/Leonardo"))
sys.path.insert(0, LEONARDO_ROOT)
os.chdir(LEONARDO_ROOT)  # the workflow resolves data/ paths relative to the repo

from fastapi import FastAPI  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from leonardo.workflows.research import (  # noqa: E402
    CanonEntry,
    build_brief,
    co_occurring_concepts,
    deepen_bible_parallels,
    expand_graph_mentions,
    resolve_concept_nodes,
    run_research_workflow,
    semantic_neighbors,
    cached_web_hits,
)

app = FastAPI(title="leonardo-workshop-sidecar")


class ResearchRequest(BaseModel):
    canon_id: str | None = None
    topic: str | None = None
    mention_limit: int = 100
    include_semantic: bool = True


class GraphRequest(BaseModel):
    name: str


def _adhoc_entry(name: str) -> CanonEntry:
    return CanonEntry(
        canon_id=f"ADHOC-{abs(hash(name)) % 99999:05d}",
        phase=0,
        phase_slug="adhoc",
        concept_name=name,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True}


# ── granular graph access for the Leonardo chat (deeper than keyword search) ──

@app.post("/graph/concept")
def graph_concept(req: GraphRequest) -> dict[str, Any]:
    """A concept's real provenance: matched concept(s) + mentions (author/work/year/excerpt)."""
    name = (req.name or "").strip()
    if len(name) < 2:
        return {"ok": False, "error": "name too short"}
    try:
        from leonardo.graph.neo4j_store import GraphStore

        with GraphStore() as store:
            concepts = resolve_concept_nodes(store, _adhoc_entry(name))
            ids = [c["id"] for c in concepts if c.get("id")]
            if not ids:
                return {"ok": True, "name": name, "concepts": [], "mentions": [], "note": "no matching concept in the graph"}
            mentions = expand_graph_mentions(store, ids, limit=24)
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}
    return {
        "ok": True,
        "name": name,
        "concepts": [
            {"name": c.get("preferred_name") or c.get("normalized_name"), "mentions": c.get("mention_count")}
            for c in concepts[:5]
        ],
        "mentions": [
            {
                "author": m.get("author") or "",
                "work": m.get("work") or "",
                "year": m.get("year"),
                "source_kind": m.get("source_kind") or "",
                "excerpt": (m.get("excerpt") or "")[:280],
            }
            for m in mentions[:12]
        ],
    }


@app.post("/graph/related")
def graph_related(req: GraphRequest) -> dict[str, Any]:
    """Concepts that co-occur with this one in the same source passages."""
    name = (req.name or "").strip()
    if len(name) < 2:
        return {"ok": False, "error": "name too short"}
    try:
        from leonardo.graph.neo4j_store import GraphStore

        with GraphStore() as store:
            concepts = resolve_concept_nodes(store, _adhoc_entry(name))
            ids = [c["id"] for c in concepts if c.get("id")]
            if not ids:
                return {"ok": True, "name": name, "related": [], "note": "no matching concept in the graph"}
            co = co_occurring_concepts(store, ids, limit=20)
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}
    return {
        "ok": True,
        "name": name,
        "related": [{"name": r.get("preferred_name"), "together": r.get("co_occurrence")} for r in co],
    }


@app.post("/graph/bible")
def graph_bible(req: GraphRequest) -> dict[str, Any]:
    """Bible parallels for a concept: capacities / symbols / verses (read-only KG)."""
    name = (req.name or "").strip()
    if len(name) < 2:
        return {"ok": False, "error": "name too short"}
    try:
        from leonardo.graph.neo4j_store import GraphStore

        with GraphStore() as store:
            parallels = deepen_bible_parallels(store, _adhoc_entry(name))
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}
    return {
        "ok": True,
        "name": name,
        "parallels": [
            {
                "type": p.get("type") or "",
                "name": p.get("name") or "",
                "tightness": p.get("tightness_score"),
            }
            for p in parallels[:12]
        ],
    }


_SEARCH_BLOCK = ["gutenberg", "copyright", "license", "licence", "trademark", "donation", "ebook", "public domain"]


@app.post("/graph/search")
def graph_search(req: GraphRequest) -> dict[str, Any]:
    """Keyword/substring search → ranked concept candidates (browse the graph).

    Mirrors the gateway's realGraphSearch Cypher so the chat has one canonical
    entry point for discovery before deep-diving with /graph/concept.
    """
    q = (req.name or "").strip().lower()
    if len(q) < 2:
        return {"ok": True, "hits": []}
    cypher = (
        "MATCH (c:Concept)\n"
        "WITH c, toLower(coalesce(c.preferred_name, c.normalized_name, '')) AS lname\n"
        "WHERE lname CONTAINS $q AND NONE(t IN $block WHERE lname CONTAINS t)\n"
        "WITH c, lname LIMIT 250\n"
        "OPTIONAL MATCH (c)<-[:INSTANCE_OF]-(m:ConceptMention)\n"
        "WITH c, lname, count(m) AS mentions\n"
        "RETURN coalesce(c.preferred_name, c.normalized_name, '(unnamed)') AS name,\n"
        "       mentions,\n"
        "       CASE WHEN lname STARTS WITH $q THEN 1 ELSE 0 END AS isPrefix\n"
        "ORDER BY isPrefix DESC, mentions DESC\n"
        "LIMIT 12"
    )
    try:
        from leonardo.graph.neo4j_store import GraphStore

        with GraphStore() as store:
            rows = store.run_query(cypher, {"q": q, "block": _SEARCH_BLOCK})
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}
    return {
        "ok": True,
        "hits": [{"name": r.get("name"), "mentions": r.get("mentions")} for r in rows],
    }


# ── REAL Council memory (separate Neo4j on :7688, semantic vector recall) ────
# The council writes its deliberations (MemoryClaim/SummaryMemory nodes, 3072-dim
# text-embedding-3-large vectors) to its OWN graph — NOT the Leonardo graph on
# 7687. Recall mirrors claw-memory's semantic_recall: embed the query, vector-
# query both claim+summary indexes, merge by score. READ ONLY — no recall-time
# edge writes, no remember.
import re as _re

_COUNCIL_DRIVER = None
_COUNCIL_INDEXES = ("idx_mem_claim_embedding", "idx_summary_mem_embedding")


class CouncilRequest(BaseModel):
    query: str
    limit: int = 5


def _council_driver():
    global _COUNCIL_DRIVER
    if _COUNCIL_DRIVER is None:
        import neo4j

        uri = os.environ.get("COUNCIL_NEO4J_URI", "bolt://localhost:7688")
        user = os.environ.get("COUNCIL_NEO4J_USER", "neo4j")
        pwd = os.environ.get("COUNCIL_NEO4J_PASSWORD")
        if not pwd:
            raise RuntimeError("COUNCIL_NEO4J_PASSWORD not set")
        _COUNCIL_DRIVER = neo4j.GraphDatabase.driver(uri, auth=(user, pwd))
    return _COUNCIL_DRIVER


def _embed(text: str) -> list[float]:
    """Embed a query with the same model the council indexed with (3072-dim)."""
    import httpx

    key = os.environ.get("COUNCIL_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("no OpenAI key for council embeddings")
    r = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": "text-embedding-3-large", "input": text[:8000]},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["data"][0]["embedding"]


def _parse_status(text: str) -> str | None:
    m = _re.search(r"Status:\s*([^\n.]+)", text or "")
    if not m:
        return None
    # Keep just the verdict (e.g. "VERIFIED / PASS_TO_BUILD"), drop trailing prose.
    return m.group(1).strip().split(". ")[0][:60] or None


@app.post("/council/search")
def council_search(req: CouncilRequest) -> dict[str, Any]:
    """Semantic recall over the REAL Council memory graph. Read-only."""
    q = (req.query or "").strip()
    if len(q) < 2:
        return {"ok": True, "hits": []}
    try:
        vec = _embed(q)
        driver = _council_driver()
        top_k = req.limit + 8
        merged: dict[str, dict[str, Any]] = {}
        with driver.session() as s:
            for index_name in _COUNCIL_INDEXES:
                cypher = (
                    "CALL db.index.vector.queryNodes($index, $k, $vec) YIELD node AS n, score "
                    "RETURN n.nodeId AS id, coalesce(n.content, n.summary) AS text, "
                    "       n.owner_seat AS seat, toString(n.created_at) AS created_at, score"
                )
                try:
                    rows = s.run(cypher, index=index_name, k=top_k, vec=vec).data()
                except Exception:
                    rows = []
                for r in rows:
                    nid = r.get("id")
                    text = r.get("text") or ""
                    if not nid or not text:
                        continue
                    prev = merged.get(nid)
                    if prev is None or r.get("score", 0) > prev["score"]:
                        merged[nid] = {
                            "seat": (r.get("seat") or "").replace("seat:", ""),
                            "status": _parse_status(text),
                            "snippet": text[:700],
                            "created_at": r.get("created_at"),
                            "score": r.get("score", 0),
                        }
        hits = sorted(merged.values(), key=lambda h: h["score"], reverse=True)[: req.limit]
        return {"ok": True, "hits": hits}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _compact(brief: dict[str, Any], path: str | None) -> dict[str, Any]:
    """Trim the brief to what a chat card / API consumer needs."""
    pack = brief.get("evidence_pack", {}) or {}
    lb = brief.get("leonardo_brief", {}) or {}
    mentions = pack.get("graph_mentions_added", []) or []
    bible = lb.get("bible_parallel", {}) or {}
    return {
        "ok": True,
        "canon_id": brief.get("canon_id"),
        "concept": brief.get("concept_name"),
        "what_it_is": str(lb.get("what_it_is", ""))[:400],
        "modern_analogue": str(lb.get("modern_analogue", ""))[:300],
        "bible_parallel": bible.get("primary_capacity"),
        "risk": str(lb.get("risk_top_1", ""))[:300],
        "counts": {
            "concepts": len(pack.get("resolved_concepts", []) or []),
            "mentions": len(mentions),
            "co_occurrences": len(pack.get("co_occurring_concepts", []) or []),
            "bible_parallels": len(pack.get("bible_parallels_deepened", []) or []),
            "semantic_neighbors": len(pack.get("semantic_neighbors", []) or []),
            "web_hits": len(pack.get("web_hits", []) or []),
        },
        "sample_mentions": [
            {
                "work": m.get("work") or "",
                "author": m.get("author") or "",
                "snippet": (m.get("excerpt") or "")[:200],
            }
            for m in mentions[:5]
        ],
        "path": path,
    }


@app.post("/research")
def research(req: ResearchRequest) -> dict[str, Any]:
    if req.canon_id:
        try:
            out = run_research_workflow(
                canon_id=req.canon_id,
                include_semantic=req.include_semantic,
                mention_limit=req.mention_limit,
            )
        except Exception as e:  # honest failure, no stack leak
            return {"ok": False, "error": str(e)[:300]}
        brief = out["brief"]
        brief.setdefault("concept_name", out["entry"].concept_name)
        return _compact(brief, out.get("path"))

    topic = (req.topic or "").strip()
    if len(topic) < 3:
        return {"ok": False, "error": "topic too short"}

    # Ad-hoc entry: same evidence pipeline, no canon file required.
    entry = CanonEntry(
        canon_id=f"ADHOC-{abs(hash(topic)) % 99999:05d}",
        phase=0,
        phase_slug="adhoc",
        concept_name=topic,
    )
    try:
        from leonardo.graph.neo4j_store import GraphStore

        with GraphStore() as store:
            concepts = resolve_concept_nodes(store, entry)
            concept_ids = [row["id"] for row in concepts if row.get("id")]
            if not concept_ids:
                return {"ok": True, "concept": topic, "counts": {"concepts": 0}, "sample_mentions": [],
                        "note": "no matching concepts in the graph"}
            mentions = expand_graph_mentions(store, concept_ids, limit=req.mention_limit)
            co = co_occurring_concepts(store, concept_ids)
            bible = deepen_bible_parallels(store, entry)
            sem = semantic_neighbors(entry) if req.include_semantic else []
            web = cached_web_hits(entry)
            brief = build_brief(
                entry,
                graph_mentions=mentions,
                co_occurrences=co,
                semantic_neighbors=sem,
                bible_deepened=bible,
                web_hits=web,
            )
            brief["evidence_pack"]["resolved_concepts"] = concepts
            brief.setdefault("concept_name", topic)
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}
    return _compact(brief, None)
