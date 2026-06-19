"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// Base Sepolia is the chain payments settle on (x402); Base mainnet is kept for
// the live ERC-8004 read. Wallets: Phantom (EVM) + the common Base/EVM wallets.
const config = createConfig({
  chains: [baseSepolia, base],
  connectors: [
    injected({ target: "phantom" }),
    coinbaseWallet({ appName: "Leonardo Platform" }),
    injected({ target: "metaMask" }),
    injected(), // any other browser wallet (Rabby, Brave, Trust, …)
  ],
  // We list wallets explicitly, so skip auto-discovery to avoid duplicate entries.
  multiInjectedProviderDiscovery: false,
  transports: { [baseSepolia.id]: http(), [base.id]: http() },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
