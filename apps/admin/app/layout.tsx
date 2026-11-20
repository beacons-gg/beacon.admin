import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Providers } from "./providers";
import "./globals.css";

// The console's fonts, carried here as files so the
// build needs no network for them: Inter, variable, for text; JetBrains Mono for machine values.
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  // The whole axis: without it the face matches weight 400 only, and medium and semibold text
  // render regular or synthesised.
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-Regular.woff2", weight: "400" },
    { path: "./fonts/JetBrainsMono-Medium.woff2", weight: "500" },
    { path: "./fonts/JetBrainsMono-SemiBold.woff2", weight: "600" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Beacon Console",
  description:
    "The operator console for Beacon servers: signed admin operations from a browser wallet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
