/**
 * The tower, six rows of five cells: a lamp, its light, the mast, the base. Gold only on the lamp,
 * the one color the mark carries. `app/icon.svg` draws the same cells as the favicon.
 */
const TOWER = ["..#..", ".#.#.", "..#..", "..#..", ".###.", "#####"];

/** The pixel tower alone. A `size` that is a multiple of six keeps every cell on whole pixels. */
function Tower({ size = 24 }: { size?: number }) {
  const cell = size / TOWER.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="block">
      {TOWER.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "#" ? (
            <rect
              key={`${x}-${y}`}
              x={x * cell + cell / 2}
              y={y * cell}
              width={cell - 1}
              height={cell - 1}
              className={y === 0 ? "fill-gold" : "fill-foreground"}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

/** The brand mark: the tower, `beacon` in mono with a terminal's blinking cursor, `~/console` under it. */
export function Mark() {
  return (
    <span className="flex items-center gap-2.5">
      <Tower />
      <span className="leading-none">
        <span className="block font-mono text-[17px] font-semibold tracking-[-0.01em] text-foreground">
          beacon
          <span
            className="blink ml-[3px] inline-block h-[15px] w-2 bg-gold align-[-2px]"
            aria-hidden
          />
        </span>
        <span className="mt-[5px] block font-mono text-[11px] text-ink-3">~/console</span>
      </span>
    </span>
  );
}
