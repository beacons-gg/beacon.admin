import { PageBody } from "@/components/primitives";
import { BackupPanel } from "@/features/backup";

/**
 * `?add=<origin>` offers a server to add, as on the Servers page: a link from elsewhere, such as a
 * hosting dashboard, lands an owner on Backup with that server. Offered only; the operator presses
 * Add.
 */
export default async function BackupPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string | string[] }>;
}) {
  const { add } = await searchParams;
  return (
    <PageBody>
      <BackupPanel addAddress={typeof add === "string" ? add : undefined} />
    </PageBody>
  );
}
