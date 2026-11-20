import type { MediaCredit } from "@beaconsgg/protocol-types";

/** "CC BY-SA 4.0 · Jane Doe" — whichever parts the source actually exposed, never an empty label. */
function creditLine(credit: MediaCredit): string {
  return [credit.license, credit.author].filter(Boolean).join(" · ") || "Credited source";
}

/**
 * The detail-only descriptor block both panels render: the description paragraph (with its
 * attribution when the text came from a source with terms), the "also known as" line, and the
 * outbound website/Wikipedia links. One home for the link invariants (`target="_blank"` +
 * `noreferrer` on untrusted OSM-/admin-sourced URLs, truncation); margins stay contextual via the
 * classNames.
 *
 * The credit renders immediately under the text it credits and never on its own — it is an attribute
 * of that paragraph, not a fact about the place. `mergeFields` guarantees the pairing upstream.
 */
export function PlaceDescriptor({
  description,
  descriptionCredit,
  website,
  wikipedia,
  altNames,
  descriptionClassName = "",
  websiteClassName = "",
}: {
  description?: string | undefined;
  descriptionCredit?: MediaCredit | undefined;
  website?: string | undefined;
  wikipedia?: string | undefined;
  altNames?: readonly string[] | undefined;
  descriptionClassName?: string;
  websiteClassName?: string;
}) {
  const link = (href: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`block truncate text-xs text-foreground underline decoration-zinc-600 hover:text-foreground ${websiteClassName}`}
    >
      {href}
    </a>
  );
  return (
    <>
      {description ? (
        <p className={`text-xs text-muted-foreground ${descriptionClassName}`}>{description}</p>
      ) : null}
      {description && descriptionCredit ? (
        <p className="text-[11px] text-muted-foreground/70">{creditLine(descriptionCredit)}</p>
      ) : null}
      {altNames?.length ? (
        <p className={`text-xs text-muted-foreground ${descriptionClassName}`}>
          Also known as: {altNames.join(" · ")}
        </p>
      ) : null}
      {website ? link(website) : null}
      {wikipedia ? link(wikipedia) : null}
    </>
  );
}
