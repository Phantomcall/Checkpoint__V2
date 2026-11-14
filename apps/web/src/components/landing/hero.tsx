"use client";

import { ArrowRight, ChevronDown, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ALL_DONE, GuardCard, VaultCard, YouCard, type LockSteps } from "./lock-story";
import { isTouch } from "@/lib/perf";
import { VaultDoor } from "./vault-door";
import { easeInOut, passed, seg, T } from "./vault-timeline";

const HEADLINE = ["Your agents shop.", "Three locks decide."];
/** localStorage key for the phone switch that turns the scroll story off ("off") or back on ("on"). */
const ANIM_KEY = "cp-vault-anim";
const BODY =
  "Agents research real offers and build a basket. Guard checks every price and signs only that basket. You approve its exact hash, and the Vault checks your caps before a single cpUSD moves.";

/**
 * The headline is written one line at a time by a single continuous pen stroke: a steady speed, easing only at
 * the start and end of each line. The paragraph and buttons fade in underneath while it writes.
 */
const PEN_MS_PER_CHAR = 82;
const START_MS = 300;
const LINE_GAP_MS = 120;
function penLines(lines: string[]) {
  let at = START_MS;
  return lines.map((text, i) => {
    const d = text.length * PEN_MS_PER_CHAR;
    const el = (
      <span key={i} className={`ink-line ${i ? "hero-ink-gold" : ""}`} style={{ "--ink-at": `${at}ms`, "--ink-d": `${d}ms` } as React.CSSProperties}>
        <span className="ink-pen">{text}</span>
      </span>
    );
    at += d + LINE_GAP_MS;
    return el;
  });
}

/** where a handoff is, 0..1 (unclamped, so callers can tell before from after) */
const handU = (p: number, h: 0 | 1) => (p - T.hand[h][0]) / (T.hand[h][1] - T.hand[h][0]);

const LOCKS = [
  { key: "guard", label: "Guard", n: "I" },
  { key: "you", label: "You", n: "II" },
  { key: "vault", label: "Vault", n: "III" },
] as const;

/**
 * The landing hero: a vault door fills the screen. Scrolling pins it and tells the three locks over the
 * mechanism: Guard's card while the wheel turns, yours as the bolts pull back and the door swings, the Vault's
 * as the camera walks up to the gold. Between locks the finished card swings open on its hinge like the vault door
 * itself; the next one comes forward from behind it, or swings shut into place on the other side of the screen.
 * The headline is handwritten in on load; the paragraph and buttons fade in beneath it as it's written.
 * With reduced motion there's no pinning: a still door, the copy, and the three cards as a plain list.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const progress = useRef(0);
  const [webgl, setWebgl] = useState(true);
  const [go, setGo] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Phones can turn the scroll story off (it's several screens of scrolling there); the choice is remembered.
  const [animOff, setAnimOff] = useState(false);
  const still = reduced || animOff;
  const [steps, setSteps] = useState<LockSteps>({ guard: 0, you: 0, vault: 0 });
  const [active, setActive] = useState(-1);

  // Start writing once the script face is in (or after a second, whichever comes first), and not while the
  // intro is still covering the page.
  useEffect(() => {
    let done = false;
    let t = 0;
    const begin = () => !done && ((done = true), setGo(true));
    const ready = () => {
      document.fonts?.load('1em "Parisienne"').then(begin, begin);
      t = window.setTimeout(begin, 1200);
    };
    if (document.documentElement.dataset.intro === "play") window.addEventListener("cp-intro-done", ready, { once: true });
    else ready();
    return () => {
      clearTimeout(t);
      window.removeEventListener("cp-intro-done", ready);
    };
  }, []);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try {
      setAnimOff(localStorage.getItem(ANIM_KEY) === "off");
    } catch {}
  }, []);
  const setAnim = (on: boolean) => {
    setAnimOff(!on);
    try {
      localStorage.setItem(ANIM_KEY, on ? "on" : "off");
    } catch {}
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (still) {
      progress.current = 0;
      return;
    }
    let raf = 0;
    let prev = performance.now();
    let last = { g: -1, y: -1, v: -1, a: -2 };
    // the plates, and the unturned boxes they sit in (for where each one is on screen)
    const card = (i: number) => slots.current[i]?.querySelector<HTMLElement>(".vault-card") ?? null;
    const midX = (i: number) => {
      const r = card(i)?.parentElement?.getBoundingClientRect();
      return r ? r.left + r.width / 2 : 0;
    };
    // A few frames after mount, paint every card once at near-zero opacity, so their first-time raster costs
    // land now rather than mid-scroll.
    let frame = 0;
    const warm = () =>
      slots.current.forEach((s) => {
        if (!s) return;
        s.style.visibility = "visible";
        s.style.opacity = "0.002";
        s.style.setProperty("--press", "0.5");
      });
    // Where the section sits, measured on resize rather than every frame: reading layout after the loop's style writes
    // would force the browser to recompute it each frame.
    const box = { top: 0, height: 1 };
    const measure = () => {
      const el = section.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      box.top = r.top + window.scrollY;
      box.height = r.height;
    };
    measure();
    const boxWatch = new ResizeObserver(measure);
    if (section.current) boxWatch.observe(section.current);
    window.addEventListener("resize", measure);
    // A little inertia, so the mechanism feels heavy rather than glued to the scrollbar. A finger already scrolls
    // smoothly, so on touch it follows twice as closely and never feels like it lags behind.
    const follow = isTouch() ? 15 : 7;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const el = section.current;
      if (el) {
        const target = seg(window.scrollY - box.top, 0, Math.max(1, box.height - window.innerHeight));
        progress.current += (target - progress.current) * (1 - Math.exp(-dt * follow));
        if (Math.abs(target - progress.current) < 1e-4) progress.current = target;
        const p = progress.current;
        if (copy.current) {
          const k = seg(p, ...T.copyOut);
          copy.current.style.opacity = String(1 - k);
          copy.current.style.transform = `translate3d(${-k * 40}px, 0, 0)`;
          copy.current.style.visibility = k >= 1 ? "hidden" : "visible";
        }
        if (cue.current) cue.current.style.opacity = String(1 - seg(p, 0, 0.04));
        if (fade.current) fade.current.style.opacity = String(seg(p, ...T.fade));

        // the three cards. Guard slides in. After that, the finished card swings open on its outer hinge (toward
        // you, like the vault door) and the next one either comes forward from behind it or, when it sits on the
        // other side of the screen, swings shut into place on its own hinge.
        const u0 = handU(p, 0), u1 = handU(p, 1);
        const uIn = [null, u0, u1], uOut = [u0, u1, null];
        slots.current.forEach((s, i) => {
          const el = card(i);
          if (!s || !el) return;
          const ui = uIn[i] ?? null, uo = uOut[i] ?? null;
          // hinge on the outer edge: left for cards on the left, right for the one on the right
          const right = i > 0 && midX(i) > window.innerWidth * 0.6;
          const sign = right ? 1 : -1;
          let opacity = 1, tx = 0, ty = 0, rot = 0, scale = 1, shade = 0, lift = 0;
          if (ui === null) {
            const k = seg(p, T.guard[0], T.guard[0] + 0.03);
            opacity = p < T.guard[0] ? 0 : k;
            tx = -(1 - k) * 36;
            ty = (1 - k) * 10;
          } else if (Math.abs(midX(i) - midX(i - 1)) < 60) {
            // same spot: waiting behind the outgoing plate, then forward
            const k = easeInOut(seg(ui, 0.12, 0.8));
            opacity = seg(ui, 0.02, 0.22);
            scale = 0.9 + 0.1 * k;
            lift = (1 - k) * 18;
            shade = 0.6 * (1 - k);
          } else {
            // the other side: swings shut into place
            const k = easeInOut(seg(ui, 0.3, 0.95));
            opacity = seg(k, 0, 0.18);
            rot = -sign * 96 * (1 - k);
            shade = 0.55 * (1 - k);
          }
          if (uo !== null && uo > 0) {
            const k = easeInOut(seg(uo, 0.04, 0.62));
            rot = sign * 96 * k;
            shade = Math.max(shade, 0.5 * k);
            opacity *= 1 - seg(k, 0.8, 1);
          }
          s.style.opacity = String(opacity);
          s.style.transform = `translate3d(${tx}px, ${ty + lift}px, 0)`;
          s.style.visibility = opacity <= 0.001 ? "hidden" : "visible";
          s.style.zIndex = uo !== null && uo > 0 && uo < 1 ? "2" : "1";
          el.style.transformOrigin = right ? "100% 50%" : "0% 50%";
          el.style.transform = rot || scale !== 1 ? `rotateY(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})` : "";
          s.style.setProperty("--shade", shade.toFixed(3));
          s.style.setProperty("--spin", String(Math.abs(rot) / 96));
          // light runs round the brass edge as a lock completes, and again as the next one settles
          let sw = -1;
          if (uo !== null && uo > 0 && uo < 0.12) sw = seg(uo, 0, 0.12);
          else if (ui !== null && ui > 0.8 && ui < 1) sw = seg(ui, 0.8, 1);
          else if (i === 2 && p > 0.915 && p < 0.94) sw = seg(p, 0.915, 0.94);
          s.style.setProperty("--sweep", String(Math.max(sw, 0)));
          s.style.setProperty("--sweep-on", String(sw <= 0 || sw >= 1 ? 0 : Math.sin(Math.PI * sw)));
          s.style.setProperty("--press", String(i === 1 ? seg(p, ...T.press) : 0));
        });

        const a = p < T.guard[0] ? -1 : u0 < 0.5 ? 0 : u1 < 0.5 ? 1 : 2;
        if (rail.current) {
          rail.current.style.opacity = String(seg(p, 0.06, 0.09) * (1 - seg(p, 0.97, 1)));
          rail.current.style.setProperty("--r1", String(seg(p, T.rail[0], T.rail[1])));
          rail.current.style.setProperty("--r2", String(seg(p, T.rail[2], T.rail[3])));
        }
        const g = passed(p, T.guardSteps), y = passed(p, T.youSteps), v = passed(p, T.vaultSteps);
        if (g !== last.g || y !== last.y || v !== last.v) setSteps({ guard: g, you: y, vault: v });
        if (a !== last.a) setActive(a);
        last = { g, y, v, a };
        // the next frame's pass resets everything warm() touched
        if (++frame >= 20 && frame < 24 && p < T.guard[0]) warm();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      boxWatch.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [still]);

  const headline = penLines(HEADLINE);
  const cards = [<GuardCard key="g" step={steps.guard} />, <YouCard key="y" step={steps.you} />, <VaultCard key="v" step={steps.vault} />];

  return (
    <>
      <section
        id="vault-hero"
        ref={section}
        aria-label="Checkpoint"
        // Full-bleed, tucked up under the floating nav. The extra height is the scroll that opens the door.
        className={`relative -mt-[72px] md:-mt-[100px] ${still ? "h-svh" : "h-[600svh]"}`}
        style={{ marginLeft: "calc(50% - 50vw)", width: "100vw" }}
      >
        <div className="hero-stage sticky top-0 h-svh overflow-hidden">
          {webgl ? (
            <VaultDoor progress={progress} onUnsupported={() => setWebgl(false)} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/vault-door.jpg" alt="" className="absolute inset-0 size-full object-cover object-[70%_50%]" />
          )}
          {/* keep the copy legible over the wall */}
          <div ref={copy} className="absolute inset-0">
            <div aria-hidden className="hero-scrim pointer-events-none absolute inset-0" />
            {/* phones: the scroll story is several screens long there, so it can be switched off (remembered) */}
            {!reduced && (
              <button
                type="button"
                role="switch"
                aria-checked={!animOff}
                onClick={() => setAnim(animOff)}
                className="hero-chip absolute top-[84px] right-4 z-10 flex items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-3 text-[12px] ring-1 md:hidden"
              >
                Vault animation
                <span className={`relative h-5 w-9 rounded-full transition-colors duration-300 ${animOff ? "bg-[rgb(140_132_119/0.45)]" : "bg-accent"}`}>
                  <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-[#fbf6ea] shadow transition-transform duration-300 ${animOff ? "" : "translate-x-4"}`} />
                </span>
              </button>
            )}
            <div className="relative mx-auto flex h-full w-full max-w-7xl items-center px-4 pt-24 max-lg:items-end max-lg:pb-24 max-md:pb-[150px] sm:px-6 lg:px-8">
              <div className={go ? "ink-go" : ""}>
                <p className="hero-rise hero-chip inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1.5 text-[12px] ring-1">
                  <span className="rounded-full bg-[rgb(227_180_94/0.14)] px-2 py-0.5 font-engrave text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">NEAR Hackathon 2026</span>
                  AI Security &amp; Defense
                </p>
                <h1 className="mt-6 font-script text-[clamp(3.4rem,7.2vw,8.6rem)] leading-[1.04] font-normal tracking-normal whitespace-nowrap hero-ink max-sm:mt-3 max-sm:text-[10.6vw]">
                  {headline}
                </h1>
                <p className="hero-follow mt-7 max-w-[36rem] font-lede text-[clamp(1.05rem,1.3vw,1.25rem)] leading-[1.7] font-normal tracking-[0.01em] hero-lede max-sm:mt-4 max-sm:text-[0.98rem] max-sm:leading-[1.6]">
                  {BODY}
                </p>
                <div className="hero-follow hero-follow-late mt-8 flex flex-wrap items-center gap-3 max-sm:mt-5 max-sm:gap-2 max-sm:[&>a]:h-11 max-sm:[&>a]:px-4 max-sm:[&>a]:text-sm">
                  <Link href="/desk" className="key key-primary h-12 px-6 text-[15px]">
                    Open the desk <ArrowRight aria-hidden className="size-4" />
                  </Link>
                  <Link href="#refusals" className="key hero-ghost h-12 px-6 text-[15px] ring-1">
                    <ShieldAlert aria-hidden className="size-4" /> What it refuses
                  </Link>
                  <Link href="/audit?basket=bc35e2f9-5ad5-4a73-8bb2-592173882b6c" className="key hero-ghost h-12 px-6 text-[15px] ring-1">
                    9 Nov basket
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {!still && (
            <>
              {/* the three locks, told over the mechanism */}
              <h2 className="sr-only">Three locks, each one sees the others&apos; work</h2>
              {cards.map((card, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    slots.current[i] = el;
                  }}
                  aria-hidden={active !== i}
                  style={{ opacity: 0, visibility: "hidden" }}
                  className={`pointer-events-none absolute inset-0 mx-auto flex w-full max-w-7xl items-center px-4 pt-24 max-lg:items-end max-lg:pb-5 max-md:pb-[124px] sm:px-6 lg:px-8 ${
                    i === 2 ? "justify-end" : "justify-start"
                  }`}
                >
                  <div className={`w-[min(30rem,100%)] [perspective:1600px] ${active === i ? "pointer-events-auto" : ""}`}>{card}</div>
                </div>
              ))}

              <div
                ref={rail}
                aria-hidden
                style={{ opacity: 0 }}
                className="pointer-events-none absolute inset-x-0 bottom-7 flex justify-center max-lg:top-[84px] max-lg:bottom-auto md:max-lg:top-[112px]"
              >
                <ol className="nav-plate lock-rail flex items-center gap-2 rounded-full px-3 py-1.5">
                  {LOCKS.map((l, i) => (
                    <li key={l.key} className="flex items-center gap-2">
                      {i > 0 && (
                        <span className="lock-rail-track relative h-px w-10 overflow-hidden max-sm:w-5">
                          <span className="lock-rail-fill absolute inset-0" style={{ "--rail": `var(--r${i})` } as React.CSSProperties} />
                        </span>
                      )}
                      <span
                        className={`flex items-center gap-1.5 font-engrave text-[11px] font-semibold tracking-[0.18em] uppercase transition-colors duration-500 ${
                          i <= active ? "lock-rail-on" : "lock-rail-off"
                        }`}
                      >
                        <span className="text-[10px] opacity-70">{l.n}</span> {l.label}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div ref={cue} className="hero-cue absolute inset-x-0 bottom-9 flex max-md:hidden flex-col items-center gap-1.5">
                <span className="font-engrave text-[11px] font-semibold tracking-[0.24em] uppercase">Scroll to open the vault</span>
                <ChevronDown aria-hidden className="size-4 animate-bounce" />
              </div>
            </>
          )}
          {/* the bottom of the vault melts into the page, so the next section rises out of it */}
          <div ref={fade} aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_45%,var(--color-bg)_100%)] opacity-0" />
        </div>
      </section>

      {still && (
        <section aria-labelledby="locks-title" className="py-20">
          <p className="eyebrow">How it works</p>
          <h2 id="locks-title" className="display mt-4 text-5xl text-fg">
            Three locks. <span className="gilt italic">Each one sees the others&apos; work.</span>
          </h2>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <GuardCard step={ALL_DONE.guard} />
            <YouCard step={ALL_DONE.you} />
            <VaultCard step={ALL_DONE.vault} />
          </div>
        </section>
      )}
    </>
  );
}
