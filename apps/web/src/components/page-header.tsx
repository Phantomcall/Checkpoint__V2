import { Check, type LucideIcon } from "lucide-react";

export type LockName = "guard" | "you" | "vault";

/**
 * Title block for every app page. `accent` is the part of the title set in the serif sheen the landing uses for
 * "Three locks". `locks` lights the matching rings of the dial behind it: guard inside, you in the middle, vault outside.
 */
export function PageHeader({
  eyebrow,
  title,
  accent,
  intro,
  locks = [],
  children,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  intro?: string;
  locks?: LockName[];
  children?: React.ReactNode;
}) {
  const at = accent ? title.indexOf(accent) : -1;
  return (
    <div className="relative isolate flex flex-wrap items-end justify-between gap-6 pt-14 pb-10">
      <HeaderRings locks={locks} />
      <div className="max-w-2xl">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="hero-rise mt-3 text-4xl font-semibold text-fg sm:text-5xl">
          {at < 0 ? (
            title
          ) : (
            <>
              {title.slice(0, at)}
              <span className="font-serif font-normal tracking-[-0.02em] text-transparent bg-clip-text bg-[linear-gradient(100deg,var(--color-fg)_10%,var(--color-accent)_50%,var(--color-fg)_90%)] bg-[length:220%_100%] [animation:sheen_10s_ease-in-out_1s_infinite]">
                {accent}
              </span>
              {title.slice(at + accent!.length)}
            </>
          )}
        </h1>
        {intro && <p className="mt-4 text-[15px] leading-relaxed text-muted">{intro}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

const LOCK_LABEL: Record<LockName, string> = { guard: "Guard", you: "You", vault: "Vault" };

/** The landing's lock legend, for a request: each chip turns gold once the request has passed that lock. */
export function LockChips({ locks }: { locks: LockName[] }) {
  return (
    <ol aria-label="Locks passed" className="flex gap-1.5">
      {(["guard", "you", "vault"] as const).map((l) => {
        const on = locks.includes(l);
        return (
          <li
            key={l}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.16em] uppercase ring-1 ring-inset transition-all duration-700 ${
              on ? "bg-accent-soft text-accent ring-accent/35 shadow-[0_0_24px_-6px_var(--color-accent)]" : "text-faint ring-line"
            }`}
          >
            {on ? <Check aria-hidden className="size-3" /> : <span className="size-1 rounded-full bg-current" />}
            {LOCK_LABEL[l]}
            <span className="sr-only">{on ? " passed" : " not yet"}</span>
          </li>
        );
      })}
    </ol>
  );
}

const RINGS: { lock: LockName; r: number; start: number; spin: string }[] = [
  { lock: "vault", r: 280, start: 200, spin: "animate-spin-rev" },
  { lock: "you", r: 220, start: 20, spin: "animate-spin-slow" },
  { lock: "guard", r: 160, start: 110, spin: "animate-spin-rev" },
];

/** Three tick rings, cropped at the top right of the header. A lit lock gets a gold arc on its ring. */
export function HeaderRings({ locks }: { locks: LockName[] }) {
  return (
    <div aria-hidden className="ph-rings-clip pointer-events-none absolute left-0 -right-40 -top-14 bottom-0 -z-10 hidden overflow-hidden md:block">
      <svg viewBox="0 0 600 600" className="ph-rings absolute -top-8 -right-28 size-[520px]">
        {RINGS.map(({ lock, r, start, spin }) => {
          const c = 2 * Math.PI * r;
          return (
            <g key={lock} className={`dial-ring ${spin}`}>
              <circle className="rim" cx="300" cy="300" r={r + 14} fill="none" stroke="currentColor" strokeWidth="1" />
              <circle className="ticks" cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="10" strokeDasharray={`1.2 ${c / 144 - 1.2}`} />
              {locks.includes(lock) && (
                <circle
                  className="lock"
                  cx="300"
                  cy="300"
                  r={r + 14}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${c * 0.12} ${c}`}
                  transform={`rotate(${start} 300 300)`}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Honest placeholder for a screen that lands in a later task: shows the shape of what's coming. */
export function Planned({ task, needs, title, children, Icon }: { task: string; needs?: string; title: string; children: React.ReactNode; Icon: LucideIcon }) {
  return (
    <div className="panel edge-light rounded-[var(--radius-card)] p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-inset ring-accent/25">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-fg">{title}</h2>
            <span className="rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] text-info uppercase ring-1 ring-inset ring-info/30">{task}</span>
            {needs && <span className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">needs {needs}</span>}
          </div>
          <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Skeleton block for placeholder layouts. */
export function Ghost({ className = "" }: { className?: string }) {
  return <div className={`rounded-lg bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] ${className}`} />;
}
