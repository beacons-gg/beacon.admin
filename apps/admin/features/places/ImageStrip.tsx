import type { PlaceImage } from "./logic";

/**
 * The linked place-photo strip: thumb → full-size in a new tab, CC credit line underneath. One
 * home for the invariants every panel needs — the plain `<img>` (content-addressed bytes straight
 * from the game server, no Next optimizer) and the `noreferrer` on the outbound link. Margins/gap
 * stay contextual via `className`; `size` covers the panel densities. With `onRemove`, each photo
 * grows a ✕ overlay (the editor's remove affordance) — a sibling of the link, never nested in it.
 */
export function ImageStrip({
  images,
  size = "md",
  className = "",
  onRemove,
}: {
  images: PlaceImage[];
  size?: "sm" | "md";
  className?: string;
  onRemove?: (index: number) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className={`flex flex-wrap ${className}`}>
      {images.map((img, i) => (
        <div key={img.thumb} className="relative">
          <a href={img.full} target="_blank" rel="noreferrer">
            <img
              src={img.thumb}
              alt=""
              className={`${size === "sm" ? "h-14" : "h-16"} rounded border border-border`}
            />
            {img.credit ? (
              <span
                className={`block ${size === "sm" ? "max-w-28" : "max-w-32"} truncate text-[10px] text-muted-foreground`}
              >
                {img.credit}
              </span>
            ) : null}
          </a>
          {onRemove ? (
            <button
              aria-label="Remove photo"
              className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card px-1 text-[10px] leading-4 text-foreground hover:bg-muted"
              onClick={() => onRemove(i)}
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
