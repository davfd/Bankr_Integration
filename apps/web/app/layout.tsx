import type { Metadata, Viewport } from "next";
import { Cinzel, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0b12",
  colorScheme: "dark",
};

const cinzel = Cinzel({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Leonardo Platform",
  description: "Run an agent on the harness — Council and Workshop as services, metered in $LEO on Base.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${manrope.variable}`}>
      <body className="grain">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
