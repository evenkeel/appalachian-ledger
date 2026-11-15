/** The same three rolling ridges used in the wordmark and sign-in landscape. */
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
