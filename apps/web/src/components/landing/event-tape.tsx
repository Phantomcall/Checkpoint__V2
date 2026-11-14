/** The 9 Nov partial payout (`03d5debd…`, tx `7FwX…nN5s`): two vendors, 66.66 cpUSD, policy v4. Event names match the agents and the Vault. */
const EVENTS: { name: string; tone: "ok" | "warn" | "bad" | "info"; detail: string }[] = [
  { name: "research.offer", tone: "info", detail: "storage-backblaze  $6.95" },
  { name: "policy.verdict", tone: "bad", detail: "storage-cloudflare-r2  BLOCK  R-05  18773 bps" },
  { name: "policy.verdict", tone: "warn", detail: "vps-ovhcloud  REVIEW  R-07  1891 bps" },
  { name: "coordinator.basket", tone: "info", detail: "2 vendors  66.66 cpUSD" },
  { name: "guard.signed", tone: "ok", detail: "key v1  expires 15 min" },
  { name: "basket_approved", tone: "ok", detail: "c8fffa7b…7334744d" },
  { name: "basket_executed", tone: "ok", detail: "policy v4  tx 7FwX…nN5s" },
  { name: "payout_settled", tone: "ok", detail: "vendor-02  59.71" },
  { name: "payout_failed", tone: "warn", detail: "vendor-06  6.95 restored" },
  { name: "basket_finalised", tone: "warn", detail: "PartiallyPaid" },
];
const DOT = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-info" };

export function EventTape() {
  return (
    <div className="relative -mx-4 overflow-hidden border-y border-line bg-[color-mix(in_srgb,var(--color-surface)_40%,transparent)] py-3 sm:-mx-6 lg:-mx-8 [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
      <div className="flex w-max animate-marquee">
        {[0, 1].map((k) => (
          <ul key={k} aria-hidden={k === 1} className="flex shrink-0">
            {EVENTS.map((e, i) => (
              <li key={i} className="flex items-center gap-2.5 border-r border-line px-6 font-mono text-[11.5px] whitespace-nowrap">
                <span className={`size-1.5 rounded-full ${DOT[e.tone]}`} />
                <span className="text-fg/90">{e.name}</span>
                <span className="text-faint">{e.detail}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
