// Live smoke test of the complete chatbot — drives runChatTurn with the REAL
// brain (codex rail), REAL graph search, and REAL council memory. No auth, no
// HTTP: exercises the exact code path /api/chat uses. Run with the same env the
// gateway runs with. Not a vitest (it hits the live brain + Neo4j); invoke via
//   env CHAT_CODEX_MODEL=… CODEX_CLI_PATH=… WORKSHOP_SIDECAR_URL=… \
//       LEONARDO_SOUL_PATH=… HISTORY_ROOT=… bun run src/chat/smoke.live.ts
import { runChatTurn, type AnthropicLike } from "./agent";
import { realGraphSearch } from "../graph";
import { recordCouncil, searchCouncilMemory } from "../council-memory";
import { codexClient } from "./codex";

type Msg = { role: "user" | "assistant"; content: unknown };

async function turn(client: AnthropicLike, label: string, messages: Msg[]): Promise<string> {
  process.stdout.write(`\n──────── ${label} ────────\n`);
  let text = "";
  const tools: string[] = [];
  for await (const f of runChatTurn({
    client,
    model: process.env.CHAT_CODEX_MODEL ?? "gpt-5.4-mini",
    messages,
    deps: { graphSearch: realGraphSearch, searchCouncil: searchCouncilMemory },
  })) {
    if (f.type === "text") text += f.delta;
    else if (f.type === "tool_start") tools.push(f.name);
    else if (f.type === "tool_result") process.stdout.write(`  [tool ${f.name} → ok]\n`);
    else if (f.type === "compaction") process.stdout.write(`  [compaction through ${f.throughCount}]\n`);
    else if (f.type === "confirm_required") process.stdout.write(`  [confirm_required: ${f.action} ${f.price}]\n`);
    else if (f.type === "error") process.stdout.write(`  [ERROR: ${f.message}]\n`);
  }
  process.stdout.write(`tools used: ${tools.join(", ") || "(none)"}\n`);
  process.stdout.write(`reply:\n${text}\n`);
  return text;
}

async function main() {
  const client = codexClient();

  // 1) Seed a distinctive council ruling so recall has a needle to find.
  recordCouncil({
    wallet: "0xb562fa73dd449fbd81484eddd59ba397a7515248",
    idea: "SMOKE-TEST-MARKER: bind agent authority to a revocable true-name, not the raw key",
    mode: "panel",
    verdicts: [{ seat: "archimedes", verdict: "the revocable-name primitive is mechanically sound" }],
    synthesis: "ACCEPT — authority should attach to a revocable name so a compromised key can be rotated without losing reputation.",
  });
  process.stdout.write("seeded 1 council record (SMOKE-TEST-MARKER)\n");

  // 2) Graph deep-dive: should chain search_graph → graph_concept and cite a real source.
  await turn(client, "GRAPH DEPTH (memory palace)", [
    { role: "user", content: "Search the imagination graph for the concept of a 'memory palace', then pull its provenance — who wrote about it and in what work? Cite the source." },
  ]);

  // 3) Council recall: should call council_memory and surface the seeded ruling.
  await turn(client, "COUNCIL MEMORY RECALL", [
    { role: "user", content: "Has the Council already ruled on how to bind an agent's authority to a revocable name? If so, what did they decide?" },
  ]);

  // 4) Persona sanity: must be the Hermes Leonardo, must NOT claim filesystem/pipeline powers.
  await turn(client, "PERSONA", [
    { role: "user", content: "In two sentences: who are you, and can you read files on my computer or run multi-day pipelines?" },
  ]);

  process.stdout.write("\n=== council_memory direct search check ===\n");
  const hits = searchCouncilMemory("revocable name authority");
  process.stdout.write(`direct searchCouncilMemory hits: ${hits.length} (top idea: ${hits[0]?.idea?.slice(0, 50) ?? "none"})\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
