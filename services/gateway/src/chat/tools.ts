// Tool definitions for the Leonardo chat agent + dispatch for the free ones.
// Paid tools (council) are NEVER executed inside the chat stream — the agent
// loop emits a confirm_required frame and the client pays the existing
// /api/council/* routes directly. Descriptions are prescriptive about WHEN to
// call (the model under-reaches for tools without it).

import type { GraphSearcher } from "../graph";
import type { CouncilSearcher } from "../council-memory";
import type { PaidAction } from "./frames";

export const CHAT_TOOLS = [
  {
    name: "search_graph",
    description:
      "Search the imagination graph (577K concepts from fiction, myth, sacred text; each tied to its source passage). Call this whenever the user asks about an idea, invention, motif, theme, or prior art — before answering from memory. Free. Returns concept names + mention counts; follow with graph_concept to cite a real source.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Concept to search for, e.g. 'memory palace', 'true name', 'resurrection'" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "graph_concept",
    description:
      "Deep-dive a named concept: its real provenance — author, work, year, and the actual passage (excerpt) that imagined it. FREE. Use after search_graph to ground a claim in a source you can quote.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact concept name, e.g. 'memory palace' (use a search_graph hit's name)" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "graph_related",
    description:
      "Concepts that co-occur with a given concept in the same source passages — what the graph links it to. FREE. Use to widen a search or surface adjacent prior art.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Concept name to find neighbors of" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "graph_bible",
    description:
      "Bible parallels for a concept — capacities, symbols, and verses from the scriptural knowledge graph. FREE. Use when a concept has a mythic or sacred lineage worth tracing.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Concept name to find scriptural parallels for" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "council_memory",
    description:
      "Recall what the Council has ALREADY deliberated — past verdicts and rulings on related ideas. FREE. Call this BEFORE proposing a paid Council review: if a close ruling exists, cite it instead of charging the user again.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to recall, e.g. 'agent identity reputation' or the user's idea" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "council_quick",
    description:
      "PAID ($0.05): one Council critic reviews an idea — strongest objection + smallest experiment to test it. Call ONLY when the user explicitly asks for a quick review and has been told the price; the platform then shows them a confirm-to-pay card.",
    input_schema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "The idea/dossier text to review" },
        seat: { type: "string", description: "Optional seat: kallimachos | sextus | archimedes | philo | humboldt" },
      },
      required: ["idea"],
      additionalProperties: false,
    },
  },
  {
    name: "council_panel",
    description:
      "PAID ($0.25): the full five-seat Council reviews the idea and a synthesis returns one ruling (ACCEPT/REVISE/REJECT). Takes a few minutes. Call ONLY when the user explicitly asks for the full council and has been told the price; the platform then shows a confirm-to-pay card.",
    input_schema: {
      type: "object",
      properties: {
        idea: { type: "string", description: "The idea/dossier text to review" },
      },
      required: ["idea"],
      additionalProperties: false,
    },
  },
  {
    name: "workshop_research",
    description:
      "The Workshop: produce a researched brief on a concept — graph provenance, co-occurring concepts, Bible parallels, modern analogues, top risk. Call when the user wants a concept researched/deepened (not just searched). Free in beta.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The concept/idea to research, e.g. 'true name', 'memory palace'" },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
];

export const PAID_TOOLS: Record<string, { action: PaidAction; price: string }> = {
  council_quick: { action: "council_quick", price: "$0.05" },
  council_panel: { action: "council_panel", price: "$0.25" },
};

export function isPaidTool(name: string): boolean {
  return name in PAID_TOOLS;
}

export type ChatToolDeps = { graphSearch: GraphSearcher; searchCouncil?: CouncilSearcher };

/** POST {name} to a workshop-sidecar graph endpoint; honest failure on any error. */
async function sidecarGraph(path: string, name: string): Promise<unknown> {
  const sidecar = process.env.WORKSHOP_SIDECAR_URL;
  if (!sidecar) return { status: "unavailable", message: "the graph's deeper view isn't reachable right now" };
  const clean = String(name).slice(0, 128).trim();
  if (clean.length < 2) return { status: "error", message: "concept name too short" };
  try {
    const res = await fetch(`${sidecar}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: clean }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { status: "error", message: "the graph is unreachable right now" };
    return await res.json();
  } catch {
    return { status: "error", message: "the graph is unreachable right now" };
  }
}

/** Execute a free tool server-side, inside the chat turn. */
export async function dispatchFreeTool(
  name: string,
  input: unknown,
  deps: ChatToolDeps,
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;
  if (name === "search_graph") {
    const q = String(args.query ?? "").slice(0, 128);
    if (q.trim().length < 2) return { hits: [] };
    const hits = await deps.graphSearch(q);
    return { hits };
  }
  if (name === "graph_concept") return sidecarGraph("/graph/concept", String(args.name ?? ""));
  if (name === "graph_related") return sidecarGraph("/graph/related", String(args.name ?? ""));
  if (name === "graph_bible") return sidecarGraph("/graph/bible", String(args.name ?? ""));
  if (name === "council_memory") {
    const q = String(args.query ?? "").slice(0, 300);
    if (q.trim().length < 2) return { hits: [] };
    let hits;
    if (deps.searchCouncil) {
      hits = deps.searchCouncil(q);
    } else {
      const { searchCouncilMemory } = await import("../council-memory");
      hits = searchCouncilMemory(q);
    }
    return { hits, note: hits.length === 0 ? "the Council hasn't deliberated anything close to this yet" : undefined };
  }
  if (name === "workshop_research") {
    const sidecar = process.env.WORKSHOP_SIDECAR_URL;
    if (!sidecar) {
      return {
        status: "coming_soon",
        message:
          "The Workshop isn't open yet — research briefs (graph + biblical + web evidence) are being built. For now the Council can review the idea.",
      };
    }
    const topic = String(args.topic ?? "").slice(0, 200);
    try {
      const res = await fetch(`${sidecar}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, include_semantic: false }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return { status: "error", message: "the Workshop is unreachable right now" };
      return await res.json();
    } catch {
      return { status: "error", message: "the Workshop is unreachable right now" };
    }
  }
  return { error: `unknown tool: ${name}` };
}
