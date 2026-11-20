"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActiveServerLine, GateNotice, serverLabel, useSingleServer } from "@/features/servers";
import { ConflictQueue } from "./ConflictQueue";
import { ContribExportCard } from "./ContribExportCard";
import { ExportImport } from "./ExportImport";
import { PlaceBrowser } from "./PlaceBrowser";
import { ProposalQueue } from "./ProposalQueue";
import { AtlasImportCard } from "./AtlasImportCard";
import { AtlasPinsCard } from "./AtlasPinsCard";
import { RecentRunsCard } from "./RecentRunsCard";
import { RetireSourceCard } from "./RetireSourceCard";

/**
 * The places curation surface. Curation targets ONE dataset, so it needs a
 * single active server (not "all") and an unlocked wallet for the signed admin routes; the browse
 * reads are public either way.
 */
export function PlacesPanel() {
  const gate = useSingleServer({
    server: "places curation targets one dataset at a time",
    wallet: "the curation routes are signed admin ops",
    capability: "places",
  });
  if (!gate.ok) return <GateNotice>{gate.refusal}</GateNotice>;
  const { server } = gate;

  return (
    <div className="space-y-4">
      <ActiveServerLine server={server}>Curating</ActiveServerLine>
      <Tabs defaultValue="snapshots" className="gap-4">
        <TabsList>
          <TabsTrigger value="snapshots">Import &amp; runs</TabsTrigger>
          <TabsTrigger value="contributions">Contributions</TabsTrigger>
          <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
          <TabsTrigger value="browse">Browse &amp; edit</TabsTrigger>
          <TabsTrigger value="transfer">Transfer</TabsTrigger>
        </TabsList>
        <TabsContent value="browse">
          <PlaceBrowser origin={server.origin} />
        </TabsContent>
        {/* Population is Atlas-first: import a volume, watch its run, audit what's trusted. The
            osm2pgsql boundary-snapshot form that used to lead this tab went with its connector's
            deprecation — a server takes places from Atlas, contributions, and its operator. */}
        <TabsContent value="snapshots" className="space-y-4">
          <AtlasImportCard origin={server.origin} serverCoverage={server.coverage} />
          <RecentRunsCard origin={server.origin} />
          <AtlasPinsCard origin={server.origin} />
          <RetireSourceCard origin={server.origin} />
        </TabsContent>
        <TabsContent value="contributions">
          {server.capabilities.includes("places-proposals") ? null : (
            <p className="mb-3 text-xs text-muted-foreground">
              {serverLabel(server)} isn&apos;t accepting new submissions (
              <code>BEACON_PLACES_PROPOSALS</code> is off). The queue stays reviewable so a backlog
              is never stranded.
            </p>
          )}
          <ProposalQueue origin={server.origin} />
        </TabsContent>
        <TabsContent value="conflicts">
          <ConflictQueue origin={server.origin} />
        </TabsContent>
        <TabsContent value="transfer">
          <ExportImport origin={server.origin} />
          <ContribExportCard origin={server.origin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
