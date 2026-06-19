import { afterEach, describe, expect, it, vi } from "vitest";
import { listIntakeRequests, requestCouncilAudit, requestCouncilPlan, requestWorkshopIntake } from "./gateway";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Agent Trust intake gateway client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("queues Council planning intake and preserves receipt boundary fields", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return jsonResponse({
        ok: true,
        request: {
          id: "intake_plan_1",
          kind: "council_plan",
          status: "queued",
          wallet: "0xabc0000000000000000000000000000000000001",
          title: "Plan Agent Passport beta",
          receipt_sha256: "a".repeat(64),
          receipt: {
            version: "leo-intake-v1",
            request_id: "intake_plan_1",
            kind: "council_plan",
            brief_commitment_sha256: "b".repeat(64),
            brief_commitment_scheme: "hmac-sha256:leo-intake-brief-v1",
            purchased: "intake_queue_slot",
            boundary: "Payment buys Council intake only; it does not buy verdict, truth, pass, safety clearance, Scripture interpretation, agent authority, reputation, or expose a public unsalted brief hash.",
          },
        },
      }, 202);
    };

    const request = await requestCouncilPlan({ title: "Plan Agent Passport beta", brief: "private plan brief" }, { fetchImpl });

    expect(request.kind).toBe("council_plan");
    expect(request.receipt_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(request.receipt.purchased).toBe("intake_queue_slot");
    expect(request.receipt.boundary).toMatch(/does not buy verdict/i);
    expect(calls[0]?.input).toContain("/api/council/plan");
    expect(JSON.parse(String(calls[0]?.init?.body ?? "{}"))).toEqual({ title: "Plan Agent Passport beta", brief: "private plan brief" });
  });

  it("queues Council audit and Workshop intake through distinct receipt routes", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string) => {
      calls.push(input);
      const isWorkshop = input.includes("/api/workshop/intake");
      const kind = isWorkshop ? "workshop_build" : "council_audit";
      return jsonResponse({
        ok: true,
        request: {
          id: `intake_${calls.length}`,
          kind,
          status: "queued",
          wallet: "0xabc0000000000000000000000000000000000001",
          title: "Audit/build request",
          receipt_sha256: "c".repeat(64),
          receipt: {
            version: "leo-intake-v1",
            request_id: `intake_${calls.length}`,
            kind,
            brief_commitment_sha256: "d".repeat(64),
            brief_commitment_scheme: "hmac-sha256:leo-intake-brief-v1",
            purchased: isWorkshop ? "workshop_intake_slot" : "intake_queue_slot",
            boundary: isWorkshop ? "Payment buys Workshop intake only; it does not buy result." : "Payment buys Council intake only; it does not buy verdict.",
          },
        },
      }, 202);
    };

    const audit = await requestCouncilAudit({ title: "Audit quest", brief: "audit privately", target: "https://example.com/quest.md" }, { fetchImpl });
    const workshop = await requestWorkshopIntake({ kind: "build", title: "Build harness", brief: "build privately" }, { fetchImpl });

    expect(audit.kind).toBe("council_audit");
    expect(workshop.kind).toBe("workshop_build");
    expect(workshop.receipt.purchased).toBe("workshop_intake_slot");
    expect(calls).toEqual(expect.arrayContaining([expect.stringContaining("/api/council/audit"), expect.stringContaining("/api/workshop/intake")]));
  });

  it("lists wallet-scoped intake receipt ledger entries", async () => {
    const fetchImpl = async (input: string) => {
      expect(input).toContain("/api/intake/requests");
      return jsonResponse({
        ok: true,
        requests: [{ id: "intake_1", kind: "council_plan", status: "queued", receipt_sha256: "e".repeat(64), receipt: { boundary: "does not buy verdict" } }],
      });
    };

    const requests = await listIntakeRequests({ fetchImpl });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.receipt.boundary).toMatch(/does not buy verdict/i);
  });
});
