import type { ReactNode } from "react";
import { KICKER } from "@/components/primitives";
import { Mark } from "@/components/shell/Mark";

/**
 * The full-screen frame the console shows before the operator is in: the mark at the top, one
 * centered column, and nothing of the console behind it. The welcome and the unlock screen share it.
 * Without children it is the blank splash shown while the browser's storage is read.
 */
export function AuthFrame({ children, wide = false }: { children?: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-page">
      {/* A low gold glow behind the column: the lamp of the mark, lit. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-18rem] left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-gold/[0.06] blur-3xl"
      />
      <header className="relative px-6 pt-6">
        <Mark />
      </header>
      {children ? (
        <main
          className={`relative mx-auto flex w-full flex-1 flex-col justify-center px-4 py-10 ${wide ? "max-w-xl" : "max-w-md"}`}
        >
          {children}
        </main>
      ) : null}
    </div>
  );
}

/** The card a step sits in. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8)] sm:p-8">
      {children}
    </section>
  );
}

/** A step's heading: the kicker, the title and the line that says why it matters. */
export function StepHead({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <p className={KICKER}>{kicker}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </>
  );
}
