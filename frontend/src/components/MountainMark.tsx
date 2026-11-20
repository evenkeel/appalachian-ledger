/** Three gentle layered hills: light blue, orange for bitcoin, dark blue. */
export function MountainMark({ size = 30 }: { size?: number }) {
  return (
    <img
      className="mountain-mark"
      src="/mountains.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
