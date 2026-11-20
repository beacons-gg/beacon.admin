"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  KeyRoundIcon,
  MapIcon,
  ServerIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { KICKER } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddServerForm, serverLabel, useServers, type SavedServer } from "@/features/servers";
import { describeWalletError, useWallet } from "@/features/wallet";
import { copyText, cn } from "@/lib/utils";
import { AuthCard, AuthFrame, StepHead } from "./AuthFrame";

/**
 * The first run: a browser with no operator wallet saved. The welcome walks a new operator from
 * nothing to a working console in four steps: an identity (created, or restored from a recovery
 * phrase), the recovery phrase backed up, the DID that goes on a server's `BEACON_ADMINS`, and a
 * first server. Each step says why it matters, and the last one can be skipped.
 *
 * The wallet unlocks as soon as the identity exists, which on its own would open the console. The
 * gate (`AccessGate`) keeps the welcome up until the operator finishes it.
 */

type Step =
  | { at: "intro" }
  | { at: "identity"; mode: "create" | "restore" }
  | { at: "backup"; mnemonic: string }
  | { at: "did" }
  | { at: "server" };

/** The passphrase floor: long enough to mean something, short enough not to be in the way. */
export const MIN_PASSPHRASE = 8;

const STEPS = ["Identity", "Back up", "Your DID", "First server"] as const;

export function Welcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>({ at: "intro" });
  const [restored, setRestored] = useState(false);

  if (step.at === "intro") {
    return (
      <AuthFrame wide>
        <Intro
          onCreate={() => setStep({ at: "identity", mode: "create" })}
          onRestore={() => setStep({ at: "identity", mode: "restore" })}
        />
      </AuthFrame>
    );
  }

  // A restored identity has its phrase backed up already, so its walk has no backup step.
  const index = { identity: 0, backup: 1, did: 2, server: 3 }[step.at];
  return (
    <AuthFrame wide>
      <Progress current={index} skipBackup={restored} />
      <AuthCard>
        {step.at === "identity" ? (
          <Identity
            mode={step.mode}
            onBack={() => setStep({ at: "intro" })}
            onCreated={(mnemonic) => setStep({ at: "backup", mnemonic })}
            onRestored={() => {
              setRestored(true);
              setStep({ at: "did" });
            }}
          />
        ) : step.at === "backup" ? (
          <Backup mnemonic={step.mnemonic} onNext={() => setStep({ at: "did" })} />
        ) : step.at === "did" ? (
          <YourDid onNext={() => setStep({ at: "server" })} />
        ) : (
          <FirstServer onDone={onDone} />
        )}
      </AuthCard>
    </AuthFrame>
  );
}

/** Where the operator is in the walk, as numbered steps. */
function Progress({ current, skipBackup }: { current: number; skipBackup: boolean }) {
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Setup steps">
      {STEPS.map((label, i) => {
        const skipped = skipBackup && i === 1;
        const done = i < current;
        return (
          <li
            key={label}
            aria-current={i === current ? "step" : undefined}
            className={cn("flex min-w-0 flex-1 flex-col gap-1.5", skipped && "opacity-40")}
          >
            <span
              className={cn(
                "h-[3px] rounded-full",
                i === current ? "bg-gold" : done ? "bg-foreground/60" : "bg-line-2",
              )}
            />
            <span
              className={cn(
                "truncate font-mono text-[10.5px] tracking-[0.08em] uppercase",
                i === current ? "text-foreground" : "text-ink-3",
              )}
            >
              {i + 1} {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Intro({ onCreate, onRestore }: { onCreate: () => void; onRestore: () => void }) {
  const points = [
    {
      icon: KeyRoundIcon,
      title: "An identity that stays with you",
      body: "A wallet in this browser signs every admin request. No account, and no password on any server.",
    },
    {
      icon: ServerIcon,
      title: "Every server in one place",
      body: "Add your Beacon servers by address. Each one checks your identity against its own admin list.",
    },
    {
      icon: MapIcon,
      title: "See it all on one map",
      body: "Rooms, scouts and places from every server, with the tools to curate and moderate them.",
    },
  ];
  return (
    <AuthCard>
      <p className={KICKER}>first run</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Welcome to Beacon Console</h1>
      <p className="mt-3 text-muted-foreground">
        The operator console for Beacon servers. Setup takes about two minutes.
      </p>
      <ul className="mt-6 grid gap-4">
        {points.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line-2 bg-background text-gold">
              <Icon className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">{body}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-7 grid gap-2 sm:grid-cols-2">
        <Button size="lg" onClick={onCreate}>
          Create a new identity
          <ArrowRightIcon className="size-4" />
        </Button>
        <Button size="lg" variant="outline" onClick={onRestore}>
          Restore with a recovery phrase
        </Button>
      </div>
    </AuthCard>
  );
}

/** Make the identity: a passphrase, and for a restore, the recovery phrase it comes from. */
function Identity({
  mode,
  onBack,
  onCreated,
  onRestored,
}: {
  mode: "create" | "restore";
  onBack: () => void;
  onCreated: (mnemonic: string) => void;
  onRestored: () => void;
}) {
  const w = useWallet();
  const [phrase, setPhrase] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const restore = mode === "restore";
  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const ready =
    passphrase.length >= MIN_PASSPHRASE && confirm === passphrase && (!restore || words >= 12);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (restore) {
        await w.importPhrase(phrase.trim().replace(/\s+/g, " ").toLowerCase(), passphrase);
        onRestored();
      } else {
        onCreated(await w.create(passphrase));
      }
    } catch (err) {
      setError(describeWalletError(err));
      setBusy(false);
    }
  };

  return (
    <>
      <StepHead
        kicker="step 1 · identity"
        title={restore ? "Restore your identity" : "Create your identity"}
      >
        {restore
          ? "Enter the twelve-word recovery phrase you saved, then choose a passphrase for this browser."
          : "Choose a passphrase. The passphrase encrypts the wallet in this browser, and you enter it each time you sign in."}
      </StepHead>
      <form
        className="mt-6 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void submit();
        }}
      >
        {restore ? (
          <div className="grid gap-2">
            <Label htmlFor="welcome-phrase">Recovery phrase</Label>
            <Textarea
              id="welcome-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="twelve words, separated by spaces"
              className="min-h-24 font-mono"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <p className="text-xs text-ink-3">{words} of 12 words</p>
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="welcome-passphrase">Passphrase</Label>
          <Input
            id="welcome-passphrase"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus={!restore}
          />
          <p className={cn("text-xs", tooShort ? "text-status-warn" : "text-ink-3")}>
            At least {MIN_PASSPHRASE} characters. A short sentence is easy to remember and hard to
            guess.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="welcome-confirm">Confirm the passphrase</Label>
          <Input
            id="welcome-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch ? (
            <p className="text-xs text-status-warn">The two passphrases do not match yet.</p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>
          <Button type="submit" size="lg" disabled={!ready || busy}>
            {busy
              ? restore
                ? "Restoring…"
                : "Creating…"
              : restore
                ? "Restore identity"
                : "Create identity"}
            {busy ? null : <ArrowRightIcon className="size-4" />}
          </Button>
        </div>
      </form>
    </>
  );
}

/** A button that copies `value`, and says so for a moment. */
function CopyButton({
  value,
  variant,
  className,
  children,
}: {
  value: string;
  variant: "ghost" | "outline";
  className?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      size="sm"
      className={className}
      onClick={() =>
        void copyText(value).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? "Copied" : children}
    </Button>
  );
}

/** The recovery phrase, shown this once, and a promise that it is written down. */
function Backup({ mnemonic, onNext }: { mnemonic: string; onNext: () => void }) {
  const [saved, setSaved] = useState(false);
  // The words cannot be shown again, so leaving the page before they are saved asks first.
  useEffect(() => {
    if (saved) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [saved]);
  const words = mnemonic.split(" ");
  return (
    <>
      <StepHead kicker="step 2 · back up" title="Save your recovery phrase">
        These twelve words are the only way to restore this identity on another browser, or here if
        you forget the passphrase. They are shown this once.
      </StepHead>
      <ol className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {words.map((word, i) => (
          <li
            key={i}
            className="flex items-baseline gap-2 rounded-md border border-line-2 bg-background px-3 py-2 font-mono text-sm"
          >
            <span className="w-5 text-right text-[11px] text-ink-3">{i + 1}</span>
            {word}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex justify-end">
        <CopyButton value={mnemonic} variant="ghost">
          Copy the words
        </CopyButton>
      </div>
      <p className="mt-3 flex gap-2 rounded-md border border-status-warn/40 bg-status-warn/10 p-3 text-xs text-status-warn">
        <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
        Anyone with these words controls this identity on every server that trusts it. Keep them
        offline, and never paste them into a website.
      </p>
      <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm">
        <Checkbox
          checked={saved}
          onCheckedChange={(v) => setSaved(v === true)}
          className="mt-0.5"
        />
        I have written down my recovery phrase and stored it somewhere safe.
      </label>
      <div className="mt-6 flex justify-end">
        <Button size="lg" disabled={!saved} onClick={onNext}>
          Continue
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </>
  );
}

/** The DID: what a server's operator puts on `BEACON_ADMINS` to make this identity an admin. */
function YourDid({ onNext }: { onNext: () => void }) {
  const { wallet } = useWallet();
  const did = wallet?.account.did ?? "";
  return (
    <>
      <StepHead kicker="step 3 · your DID" title="This is your operator DID">
        Servers know you by this DID. A server lets you manage it once your DID is on its admin
        list, the <code className="font-mono text-foreground">BEACON_ADMINS</code> setting.
      </StepHead>
      <div className="mt-6 rounded-lg border border-line-2 bg-background p-4">
        <code className="block font-mono text-[13px] break-all text-foreground">{did}</code>
        <CopyButton value={did} variant="outline" className="mt-3">
          Copy DID
        </CopyButton>
      </div>
      <ul className="mt-5 grid gap-2 text-sm text-muted-foreground">
        <li className="flex gap-2">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-status-ok" />
          Running your own server? Add this DID to its{" "}
          <code className="font-mono text-foreground">BEACON_ADMINS</code> and restart it.
        </li>
        <li className="flex gap-2">
          <EyeIcon className="mt-0.5 size-4 shrink-0 text-ink-3" />
          Someone else&apos;s server? Send them this DID. Until they add it, you can still look at
          the server&apos;s public map.
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-3">
        You can copy it again any time from the operator panel at the foot of the sidebar.
      </p>
      <div className="mt-6 flex justify-end">
        <Button size="lg" onClick={onNext}>
          Continue
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </>
  );
}

/** A first server, added the same way as on the Servers page; or none for now. */
function FirstServer({ onDone }: { onDone: () => void }) {
  const { preview } = useServers();
  const [added, setAdded] = useState<SavedServer | undefined>(undefined);
  const quickView = added !== undefined && preview === added.origin;
  return (
    <>
      <StepHead kicker="step 4 · first server" title="Add your first server">
        Enter the address of a Beacon server. The console checks its signed descriptor, then asks
        whether you are one of its admins.
      </StepHead>
      <div className="mt-6">
        {added ? (
          <div
            className={cn(
              "flex gap-3 rounded-lg border p-4 text-sm",
              quickView
                ? "border-gold/40 bg-gold/[0.06]"
                : "border-status-ok/40 bg-status-ok/[0.06]",
            )}
          >
            {quickView ? (
              <EyeIcon className="mt-0.5 size-4 shrink-0 text-gold" />
            ) : (
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-status-ok" />
            )}
            <div>
              <p className="font-medium">
                {quickView
                  ? `${serverLabel(added)} is open as a quick view`
                  : `You are an admin of ${serverLabel(added)}`}
              </p>
              <p className="mt-1 text-muted-foreground">
                {quickView
                  ? "Your DID is not on its admin list, so it is not saved to your servers. You can look at its public map until you reload. Once its operator adds your DID, add it again."
                  : "The console saved it to your servers, and every admin screen is ready for it."}
              </p>
              <button
                type="button"
                className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setAdded(undefined)}
              >
                Add another server
              </button>
            </div>
          </div>
        ) : (
          <AddServerForm onAdded={setAdded} />
        )}
      </div>
      <div className="mt-6 flex items-center justify-between gap-2">
        {added ? (
          <span />
        ) : (
          <Button variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
        )}
        <Button size="lg" disabled={!added} onClick={onDone}>
          Open the console
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </>
  );
}
