/** The app icon: three gentle layered hills on an ivory tile, for square slots. */
export function MountainMark({ size = 30 }: { size?: number }) {
  return (
    <img
      className="mountain-mark"
      src="/mark.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
