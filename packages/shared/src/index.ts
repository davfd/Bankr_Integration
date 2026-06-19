// Shared types + invariants for the Leonardo platform.
// The integrity-ordering invariant below is load-bearing: it is the rule the
// whole product depends on, so it lives in one place and is unit-tested.

export * from "./leo-agent-trust-capabilities";

/** Agent Trust Stack claim levels (mirrors leonardo-site /agent + PLATFORM_ROADMAP). */
export type ClaimLevel =
  | "conceptual"
  | "containment_scaffold"
  | "capability_module"
  | "hosted_service";

export interface Capability {
  /** Canon id, e.g. "CANON-01v2-0003". */
  canon: string;
  name: string;
  claim: ClaimLevel;
}

/**
 * Capabilities that must be LIVE (hosted_service) before a hosted agent may
 * autonomously spend: Recognition Gateway (0003) + PledgeGate (0005).
 */
export const SPEND_GATING_CAPABILITIES = [
  "CANON-01v2-0003", // Recognition Gateway
  "CANON-01v2-0005", // PledgeGate
] as const;

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

/**
 * Integrity-ordering invariant. Throws IntegrityError unless BOTH gating
 * capabilities are present as live hosted services. During the private beta
 * neither is live, so this always blocks — by design.
 */
export function assertAutonomousSpendAllowed(live: Iterable<Capability>): void {
  const liveIds = new Set(
    [...live].filter((c) => c.claim === "hosted_service").map((c) => c.canon),
  );
  const missing = SPEND_GATING_CAPABILITIES.filter((id) => !liveIds.has(id));
  if (missing.length > 0) {
    throw new IntegrityError(
      `Autonomous spend blocked: missing live gating capabilities ${missing.join(", ")}`,
    );
  }
}
