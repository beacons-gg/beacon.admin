"use client";

import { usePathname } from "next/navigation";
import { activeHref, isScreen, leadForPath, titleForPath } from "./nav";

/**
 * A screen's title and the line under it, below the header bar. Explore is the map,
 * full bleed, and has none; nor has a page that is no screen of the console's (a 404).
 */
export function PageHead() {
  const pathname = usePathname();
  if (activeHref(pathname) === "/" || !isScreen(pathname)) return null;
  const lead = leadForPath(pathname);
  return (
    <div className="px-4 pt-[22px] pb-[18px] md:px-[26px]">
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">{titleForPath(pathname)}</h2>
      {lead ? <p className="pt-1.5 text-muted-foreground">{lead}</p> : null}
    </div>
  );
}
