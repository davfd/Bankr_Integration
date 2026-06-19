import type { NextConfig } from "next";

// Hardening headers for the dashboard. No strict CSP here on purpose: wallet
// injection + Base/Base-Sepolia RPC + the dynamic gateway tunnel make a tight
// CSP brittle, and these headers already cover clickjacking, sniffing, and HSTS.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const config: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
