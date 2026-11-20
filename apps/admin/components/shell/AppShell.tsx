"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ServerLockBanner } from "@/features/lock";
import { AccessGate } from "@/features/onboarding";
import { AppSidebar } from "./AppSidebar";
import { PageHead } from "./PageHead";
import { Topbar } from "./Topbar";

/**
 * The persistent chrome: the sidebar on the page color, and each
 * route in the inset panel beside it, under the header bar, the lock banner when the selected server
 * is locked, and the screen's title. None of it shows until the wallet is unlocked (`AccessGate`).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AccessGate>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Topbar />
          <ServerLockBanner />
          <PageHead />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AccessGate>
  );
}
