"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ServerRolesProvider, ServersProvider } from "@/features/servers";
import { WalletProvider } from "@/features/wallet";

/**
 * The console's client-side provider stack: tooltips, then the wallet session + server registry.
 * The Next server holds nothing. There is one mode, dark, set on the html element in the layout.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <WalletProvider>
        <ServersProvider>
          <ServerRolesProvider>{children}</ServerRolesProvider>
        </ServersProvider>
      </WalletProvider>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  );
}
