/**
 * Browser-side photo preparation for place uploads: resize + re-encode via canvas (which also
 * strips EXIF/GPS — the server detect-and-rejects metadata-carrying bytes, it never rewrites
 * them), WebP with a JPEG fallback for engines that can't encode WebP. Uses the thumb/full
 * sizes Cartographer's media crawl encodes to, so operator uploads sit alongside a volume's pairs.
 */
import { PLACE_FULL_PX, PLACE_THUMB_PX } from "@beaconsgg/protocol-types";

/**
 * The shared sizes, imported rather than copied — an operator upload has to sit alongside pairs the server
 * ingested and pairs an Atlas volume published, and a signed manifest advertises the same two numbers.
 * Quality is local: canvas counts 0–1 where sharp counts 0–100.
 */
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.85;

/**
 * Standard base64 — the upload body encoding (`Buffer.from(data, "base64")` on the server).
 * The content id beside it is `sha256Base64url` from `@beaconsgg/identity`: THE shared hash the
 * media host re-verifies with; never a local copy.
 */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface PreparedVariant {
  bytes: Uint8Array;
  type: string;
}

async function encodeVariant(bitmap: ImageBitmap, maxPx: number): Promise<PreparedVariant> {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const encode = (type: string, quality: number): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  // An engine without WebP encoding silently falls back to PNG — detect via blob.type and use
  // JPEG instead (both are in the server's default MIME allowlist; PNG thumbnails are bloated).
  let blob = await encode("image/webp", WEBP_QUALITY);
  if (blob?.type !== "image/webp") blob = await encode("image/jpeg", JPEG_QUALITY);
  if (!blob) throw new Error("image encode failed");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
}

/** Decode + downscale one picked file into the thumb/full pair the place media model expects. */
export async function preparePlacePhoto(
  file: File,
): Promise<{ thumb: PreparedVariant; full: PreparedVariant }> {
  const bitmap = await createImageBitmap(file);
  try {
    return {
      thumb: await encodeVariant(bitmap, PLACE_THUMB_PX),
      full: await encodeVariant(bitmap, PLACE_FULL_PX),
    };
  } finally {
    bitmap.close();
  }
}
