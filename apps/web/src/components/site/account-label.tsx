"use client";

import { Check, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NAME_MAX, setAccountName, shortAccount, useAccountName } from "@/lib/account-names";

/**
 * An account as people read it: their own name for it first (if they gave one), the account id beside it.
 * The pencil opens a small editor; names live in this browser only (lib/account-names.ts).
 */
export function AccountLabel({ accountId, className = "" }: { accountId: string; className?: string }) {
  const name = useAccountName(accountId);
  const [editing, setEditing] = useState(false);
  if (editing) return <NameEditor accountId={accountId} initial={name ?? ""} onDone={() => setEditing(false)} />;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {name ? (
        <>
          <span className="truncate font-medium text-fg">{name}</span>
          <span className="shrink-0 font-mono text-[0.85em] text-faint" title={accountId}>
            {shortAccount(accountId)}
          </span>
        </>
      ) : (
        <span className="truncate font-mono text-fg" title={accountId}>
          {shortAccount(accountId)}
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={name ? `Rename ${name}` : "Name this account"}
        title={name ? "Rename this account" : "Name this account"}
        className="grid size-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_8%,transparent)] hover:text-accent"
      >
        <Pencil aria-hidden className="size-3" />
      </button>
      {!name && (
        <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-[0.85em] text-accent underline-offset-4 hover:underline">
          Add a name
        </button>
      )}
    </span>
  );
}

/** An account as read-only text: the name its owner set in this browser (if any), then the short id; full id on hover. */
export function AccountName({ accountId, className = "" }: { accountId: string; className?: string }) {
  const name = useAccountName(accountId);
  return (
    <span className={`inline-flex max-w-full min-w-0 items-baseline gap-1.5 align-baseline ${className}`} title={accountId}>
      {name && <span className="truncate font-medium text-fg">{name}</span>}
      <span className={`shrink-0 font-mono ${name ? "text-[0.88em] text-faint" : "text-fg"}`}>{shortAccount(accountId)}</span>
    </span>
  );
}

/** Inline editor: Enter or ✓ saves, Escape or ✕ cancels, saving an empty name removes it. */
export function NameEditor({ accountId, initial, onDone }: { accountId: string; initial: string; onDone: () => void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const save = () => {
    setAccountName(accountId, value);
    onDone();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="inline-flex min-w-0 items-center gap-1.5"
    >
      <input
        ref={input}
        value={value}
        maxLength={NAME_MAX}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        placeholder="Name this account"
        aria-label={`Name for ${accountId}`}
        className="h-8 w-44 min-w-0 rounded-full border border-line-strong bg-[var(--color-surface)] px-3 text-[13px] text-fg outline-none focus:border-accent/60"
      />
      <button type="submit" aria-label="Save name" className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
        <Check aria-hidden className="size-3.5" />
      </button>
      <button type="button" onClick={onDone} aria-label="Cancel" className="grid size-7 shrink-0 place-items-center rounded-full text-muted ring-1 ring-line hover:text-fg">
        <X aria-hidden className="size-3.5" />
      </button>
    </form>
  );
}
