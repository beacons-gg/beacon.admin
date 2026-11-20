import { z } from "zod";
import { getJson, on404 } from "@/lib/api";

/**
 * The fields of a room the inspect card shows, read loosely: a room record carries much more, and a
 * policy the console does not recognise in full must still show its game rather than fail the card.
 */
const roomCardSchema = z.object({
  game: z.string().optional(),
  name: z.string().optional(),
  placedBy: z.string(),
  policy: z.object({
    ops: z.record(
      z.string(),
      z.object({
        games: z.array(z.string()).optional(),
        phase: z.string().optional().catch(undefined),
      }),
    ),
  }),
  // The engine's claim ledger. A state the console can't read costs the claim row, not the card.
  state: z
    .object({
      phase: z.string().optional(),
      contributors: z.record(z.string(), z.unknown()).optional(),
      claimed: z.array(z.string()).optional(),
    })
    .optional()
    .catch(undefined),
});
export type RoomCard = z.infer<typeof roomCardSchema>;

/**
 * One room's record, whichever game it belongs to (no `games` filter: the console reads the whole
 * server), or `null` when the server no longer has it.
 */
export function getRoom(origin: string, id: string): Promise<RoomCard | null> {
  return getJson(origin, `/rooms/${encodeURIComponent(id)}`)
    .then((r) => roomCardSchema.parse(r))
    .catch(on404(null));
}
