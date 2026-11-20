import { PageBody } from "@/components/primitives";
import { ServersPanel } from "@/features/servers";

/**
 * `?add=<origin>` seeds the add field: a link from elsewhere, such as a hosting dashboard, carries
 * a server's address so the operator presses Add rather than typing it. Seeded only; the descriptor
 * is still fetched and verified before the server joins, exactly as for a typed address.
 */
export default async function ServersPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string | string[] }>;
}) {
  const { add } = await searchParams;
  return (
    <PageBody>
      <ServersPanel initialInput={typeof add === "string" ? add : undefined} />
    </PageBody>
  );
}
