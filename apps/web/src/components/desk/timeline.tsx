import { Check, CircleDashed, Loader2, X } from "lucide-react";
import type { DeskView, LaneKey } from "@/lib/agents/reducer";

export const LANES: { key: LaneKey; name: string; who: string }[] = [
  { key: "research", name: "Research", who: "Research agent" },
  { key: "guard", name: "Guard", who: "Rules engine" },
  { key: "coordinator", name: "Coordinator", who: "Basket planner" },
  { key: "approval", name: "Approval", who: "You, in your wallet" },
  { key: "settlement", name: "Settlement", who: "Vault + settlement agent" },
];

/** FR-UI03: the agent timeline, one lane per actor, driven entirely by the event log. */
export function Timeline({ view }: { view: DeskView }) {
  return (
    <ol className="relative space-y-1">
      <span aria-hidden className="absolute top-5 bottom-5 left-[21px] w-px bg-line" />
      {LANES.map(({ key, name, who }) => {
        const l = view.lanes[key];
        return (
          <li key={key} className={`relative flex gap-3 rounded-2xl p-2.5 transition-colors duration-500 ${l.status === "active" ? "bg-accent-soft" : ""}`}>
            <span
              className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full ring-1 ring-inset transition-colors duration-500 ${
                l.status === "done"
                  ? "bg-accent text-accent-fg ring-accent"
                  : l.status === "active"
                    ? "bg-[var(--color-surface)] text-accent ring-accent/50"
                    : l.status === "failed"
                      ? "bg-bad text-white ring-bad"
                      : "bg-[var(--color-surface)] text-faint ring-line"
              }`}
            >
              {l.status === "done" ? (
                <Check aria-hidden className="size-3.5" strokeWidth={3} />
              ) : l.status === "active" ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : l.status === "failed" ? (
                <X aria-hidden className="size-3.5" strokeWidth={3} />
              ) : (
                <CircleDashed aria-hidden className="size-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className={`text-[13.5px] font-medium ${l.status === "idle" ? "text-faint" : "text-fg"}`}>{name}</span>
                {l.at && <span className="font-mono text-[10px] text-faint tabular">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-muted">{l.detail ?? who}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
