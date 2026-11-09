"use client";

import { ArrowRight, ChevronDown, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VaultDoor } from "./vault-door";

const HEADLINE = ["Your agents shop.", "Three locks decide."];
const BODY =
  "Agents research real offers and build a basket. Guard checks every price and signs only that basket. You approve its exact hash, and the Vault checks your caps before a single cpUSD moves.";

/** Handwriting speed: the headline is written slowly, the paragraph quicker, like a signature then a note. */
const HEAD_CPS = 16;
const BODY_CPS = 55;
const START_MS = 350;

/** Splits text into words that are uncovered one after another, each for as long as it would take to write. */
function written(text: string, startMs: number, cps: number) {
  let at = startMs;
  const words = text.split(" ").map((w, i) => {
    const d = Math.max(140, (w.length / cps) * 1000);
    const el = (
      <span key={i} className="ink" style={{ "--ink-at": `${Math.round(at)}ms`, "--ink-d": `${Math.round(d)}ms` } as React.CSSProperties}>
        {w}
      </span>
    );
    at += d + 40;
    return el;
  });
  return { words, end: at };
}

const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

/**
 * The landing hero: a vault door fills the screen. Scrolling pins it while the wheel spins, the bolts pull back,
 * the door swings open and the camera moves into the vault, which hands over to the rest of the page.
 * The copy on the left is handwritten in on load. With reduced motion there's no pinning: a still door and the text.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const [webgl, setWebgl] = useState(true);
  const [go, setGo] = useState(false);
  const [reduced, setReduced] = useState(false);

  // Start writing once the script face is in (or after a second, whichever comes first).
  useEffect(() => {
    let done = false;
    const begin = () => !done && ((done = true), setGo(true));
    document.fonts?.load('1em "Parisienne"').then(begin, begin);
    const t = setTimeout(begin, 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setReduced(true);
    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const el = section.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const target = seg(-r.top, 0, Math.max(1, r.height - window.innerHeight));
        // A little inertia, so the mechanism feels heavy rather than glued to the scrollbar.
        progress.current += (target - progress.current) * (1 - Math.exp(-dt * 7));
        if (Math.abs(target - progress.current) < 1e-4) progress.current = target;
        const p = progress.current;
        if (copy.current) {
          const k = seg(p, 0.03, 0.17);
          copy.current.style.opacity = String(1 - k);
          copy.current.style.transform = `translate3d(${-k * 40}px, 0, 0)`;
          copy.current.style.visibility = k >= 1 ? "hidden" : "visible";
        }
        if (cue.current) cue.current.style.opacity = String(1 - seg(p, 0, 0.05));
        if (fade.current) fade.current.style.opacity = String(seg(p, 0.7, 1));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const h1 = written(HEADLINE[0]!, START_MS, HEAD_CPS);
  const h2 = written(HEADLINE[1]!, h1.end + 120, HEAD_CPS);
  const body = written(BODY, h2.end + 260, BODY_CPS);
  const after = Math.round(body.end + 150);

  return (
    <section
      ref={section}
      aria-label="Checkpoint"
      // Full-bleed, tucked up under the floating nav. The extra height is the scroll that opens the door.
      className={`relative -mt-[106px] md:-mt-[68px] ${reduced ? "h-svh" : "h-[320svh]"}`}
      style={{ marginLeft: "calc(50% - 50vw)", width: "100vw" }}
    >
      <div className="sticky top-0 h-svh overflow-hidden bg-[#050506]">
        {webgl ? (
          <VaultDoor progress={progress} onUnsupported={() => setWebgl(false)} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/vault-door.jpg" alt="" className="absolute inset-0 size-full object-cover object-[70%_50%]" />
        )}
        {/* keep the copy legible over the wall */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(4_4_6/0.82)_0%,rgb(4_4_6/0.55)_36%,transparent_62%)] max-lg:bg-[linear-gradient(0deg,rgb(4_4_6/0.92)_0%,rgb(4_4_6/0.8)_45%,rgb(4_4_6/0.15)_72%,transparent_100%)]" />

        <div className="relative mx-auto flex h-full w-full max-w-7xl items-center px-4 pt-24 max-lg:items-end max-lg:pb-24 sm:px-6 lg:px-8">
          <div ref={copy} className={`max-w-[34rem] will-change-transform ${go ? "ink-go" : ""}`}>
            <p className="hero-rise inline-flex items-center gap-2 rounded-full bg-[rgb(10_10_12/0.55)] py-1 pr-3 pl-1.5 text-[12px] text-[#c9c0ae] ring-1 ring-[rgb(227_180_94/0.25)] backdrop-blur">
              <span className="rounded-full bg-[rgb(227_180_94/0.14)] px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] text-[#e3b45e] uppercase">NEAR Hackathon 2026</span>
              AI Security &amp; Defense
            </p>
            <h1 className="mt-5 max-sm:mt-3 max-sm:text-[2.3rem] font-script text-[clamp(2.6rem,4.5vw,4.6rem)] leading-[1.08] whitespace-nowrap max-sm:whitespace-normal font-normal tracking-normal text-[#f4ead6]">
              <span className="block">{h1.words.reduce<React.ReactNode[]>((a, w, i) => (i ? [...a, " ", w] : [w]), [])}</span>
              <span className="block text-[#e3b45e]">{h2.words.reduce<React.ReactNode[]>((a, w, i) => (i ? [...a, " ", w] : [w]), [])}</span>
            </h1>
            <p className="mt-5 font-script text-[clamp(1.45rem,2.1vw,1.85rem)] leading-[1.4] text-[#ddd3bf] max-sm:mt-3 max-sm:text-[1.22rem] max-sm:leading-[1.38]">
              {body.words.reduce<React.ReactNode[]>((a, w, i) => (i ? [...a, " ", w] : [w]), [])}
            </p>
            <div className={`mt-8 flex flex-wrap items-center gap-3 max-sm:mt-5 max-sm:gap-2 max-sm:[&>a]:h-11 max-sm:[&>a]:px-4 max-sm:[&>a]:text-sm ${go ? "hero-rise" : "opacity-0"}`} style={{ animationDelay: `${after}ms` }}>
              <Link href="/desk" className="key key-primary h-12 px-6 text-[15px]">
                Open the desk <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="#refusals" className="key h-12 bg-[rgb(10_10_12/0.55)] px-6 text-[15px] text-[#f4ead6] ring-1 ring-[rgb(255_255_255/0.16)] backdrop-blur hover:ring-[rgb(227_180_94/0.5)]">
                <ShieldAlert aria-hidden className="size-4" /> What it refuses
              </Link>
            </div>
          </div>
        </div>

        {!reduced && (
          <div ref={cue} className="absolute inset-x-0 bottom-9 flex flex-col items-center gap-1.5 text-[#c9c0ae]">
            <span className="font-mono text-[10.5px] tracking-[0.22em] uppercase">Scroll to open the vault</span>
            <ChevronDown aria-hidden className="size-4 animate-bounce" />
          </div>
        )}
        {/* the bottom of the vault melts into the page, so the next section rises out of it */}
        <div ref={fade} aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_35%,var(--color-bg)_100%)] opacity-0" />
      </div>
    </section>
  );
}
