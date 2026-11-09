import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { GeistSerif } from "geist/font/serif";
import { Parisienne } from "next/font/google";
import { Atmosphere } from "@/components/site/atmosphere";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { TestnetStrip } from "@/components/site/testnet-strip";
import { Spotlight } from "@/components/ui/spotlight";
import { WalletProvider } from "@/lib/wallet";
import "./globals.css";

/** The hero's handwriting. next/font downloads it at build time and serves it from this site. */
const script = Parisienne({ weight: "400", subsets: ["latin"], variable: "--font-script-face", display: "swap" });

export const metadata: Metadata = {
  title: "Checkpoint · Procurement Desk",
  description: "AI agents propose purchases. Guard checks every offer, you approve the exact basket, and the Vault enforces your limits on NEAR.",
};

/** Sets the theme before first paint (no flash). `?theme=light|dark` overrides and persists, handy for demos and screenshots. */
const THEME_SCRIPT = `try{var q=new URLSearchParams(location.search).get("theme");if(q==="light"||q==="dark")localStorage.setItem("cp-theme",q);var t=localStorage.getItem("cp-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} ${GeistSerif.variable} ${script.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <WalletProvider>
          <Atmosphere />
          <Spotlight />
          <TestnetStrip />
          <Header />
          <main className="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">{children}</main>
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}
