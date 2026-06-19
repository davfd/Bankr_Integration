// The SSE frame protocol between the gateway chat route and the web client.
// One frame per SSE `data:` line. The web client mirrors this type
// (apps/web/lib/chat.ts) the same way GraphHit is mirrored.

export type PaidAction = "council_quick" | "council_panel";

export type ChatFrame =
  | { type: "text"; delta: string }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_result"; name: string; payload: unknown }
  | {
      type: "identity_kernel";
      enforced: true;
      agent_id: string;
      passport_id: string;
      receipts: Array<{ stage: string; hash: string; agent_id: string; passport_id: string; verdict: string; reason: string }>;
    }
  | {
      type: "confirm_required";
      action: PaidAction;
      price: string;
      tool_use_id: string;
      args: { idea: string; seat?: string };
    }
  // The exact assistant turn (incl. tool_use blocks) so the client can replay
  // history verbatim when it returns the paid tool's result.
  | { type: "assistant_message"; content: unknown[] }
  | { type: "usage"; in: number; out: number; cache_read?: number; cache_write?: number }
  // Free-tier notice: how many free prompts this wallet has left after this one.
  | { type: "free"; remaining: number }
  // Context compaction: the running summary that replaced the older turns, and
  // how many of the client's messages it now covers. The client caches this and
  // sends it back as priorSummary next turn, so it isn't recomputed every turn.
  | { type: "compaction"; summary: string; throughCount: number }
  | { type: "error"; message: string }
  | { type: "done"; pending?: boolean };

export function encodeFrame(f: ChatFrame): string {
  return `data: ${JSON.stringify(f)}\n\n`;
}

/** SSE comment line — keeps tunnels/proxies from idling the stream out. */
export const HEARTBEAT = ": ping\n\n";
