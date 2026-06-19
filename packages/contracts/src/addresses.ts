// Canonical ERC-8004 "Trustless Agents" registry deployments.
// Source: erc-8004/erc-8004-contracts README (verified on basescan; the 0x8004…
// vanity prefix is the project's deterministic CREATE2 deployment).
// Identity + Reputation are deployed on Base; Validation is deployed per-chain
// where published (left optional here, filled when confirmed for Base).

export type Erc8004Deployment = {
  chainId: number;
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  validationRegistry?: `0x${string}`;
};

export const ERC8004_ADDRESSES = {
  base: {
    chainId: 8453,
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  baseSepolia: {
    chainId: 84532,
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
} satisfies Record<string, Erc8004Deployment>;
