"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { config } from "@/lib/config";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

const LINKS = [
  { href: "/desk", label: "Desk" },
  { href: "/vault", label: "Vault" },
  { href: "/audit", label: "Audit" },
  { href: "/governance", label: "Governance" },
] as const;

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-3 z-40 mx-auto mt-3 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <nav aria-label="Main" className="glass flex h-14 items-center gap-2 rounded-full pr-2 pl-4">
        <Link href="/" aria-label="Checkpoint home" className="mr-2 shrink-0">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-0.5 md:flex">
          {LINKS.map(({ href, label }) => {
            const active = path === href || path.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${
                    active ? "bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)] text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 hidden items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[11px] text-muted lg:flex">
            <span className="size-1.5 rounded-full bg-accent text-accent animate-pulse-dot" />
            NEAR {config.network}
          </span>
          <ThemeToggle />
          <WalletButton />
        </div>
      </nav>
      <ul className="glass mx-auto mt-2 flex w-fit justify-center gap-0.5 rounded-full p-1 md:hidden">
        {LINKS.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={path.startsWith(href) ? "page" : undefined}
              className={`block rounded-full px-3 py-1 text-xs ${path.startsWith(href) ? "bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)] text-fg" : "text-muted"}`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </header>
  );
}
