import { describe, it, expect } from "vitest";
import {
  assertAutonomousSpendAllowed,
  IntegrityError,
  type Capability,
  type ClaimLevel,
} from "./index";

const gateway = (claim: ClaimLevel): Capability => ({
  canon: "CANON-01v2-0003",
  name: "Recognition Gateway",
  claim,
});
const pledge = (claim: ClaimLevel): Capability => ({
  canon: "CANON-01v2-0005",
  name: "PledgeGate",
  claim,
});

describe("integrity-ordering invariant", () => {
  it("blocks autonomous spend when no gating capabilities exist (beta state)", () => {
    expect(() => assertAutonomousSpendAllowed([])).toThrow(IntegrityError);
  });

  it("blocks when 0003/0005 are only scaffolds, not live services", () => {
    expect(() =>
      assertAutonomousSpendAllowed([
        gateway("containment_scaffold"),
        pledge("containment_scaffold"),
      ]),
    ).toThrow(IntegrityError);
  });

  it("blocks when only one of the two is live", () => {
    expect(() => assertAutonomousSpendAllowed([gateway("hosted_service")])).toThrow(
      IntegrityError,
    );
  });

  it("allows autonomous spend only when both are live hosted services", () => {
    expect(() =>
      assertAutonomousSpendAllowed([gateway("hosted_service"), pledge("hosted_service")]),
    ).not.toThrow();
  });
});
