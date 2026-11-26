import type { ReactNode } from "react";

const line = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const NavIcon = {
  dashboard: line(
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-6" />
      <path d="M4 17h16" />
    </>,
  ),
  activity: line(
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>,
  ),
  spending: line(
    <>
      <path d="M3 17l5-6 4 3 5-8 4 5" />
      <path d="M3 21h18" />
    </>,
  ),
  bills: line(
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>,
  ),
  // The bitcoin sign: a B with the two short strokes above and below.
  stack: line(
    <>
      <path d="M8 5.5h5.5a3.25 3.25 0 0 1 0 6.5H8zM8 12h6.5a3.25 3.25 0 0 1 0 6.5H8z" />
      <path d="M10.5 3v2.5M13.5 3v2.5M10.5 18.5V21M13.5 18.5V21M6 5.5h2M6 18.5h2" />
    </>,
  ),
  markets: line(
    <>
      <path d="M6 4v14M6 7H3.5M6 14h2.5" />
      <path d="M12 7v13M12 10H9.5M12 17h2.5" />
      <path d="M18 3v12M18 6h-2.5M18 12h2.5" />
    </>,
  ),
  accounts: line(
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 15h2" />
    </>,
  ),
  retirement: line(
    <>
      <path d="M2 16h20" />
      <path d="M6 16a6 6 0 0 1 12 0" />
      <path d="M12 5v2M5 8l1.4 1.4M19 8l-1.4 1.4M5 20h14" />
    </>,
  ),
  learn: line(
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    </>,
  ),
  settings: line(
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>,
  ),
  plus: line(<path d="M12 5v14M5 12h14" />),
  more: line(<path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="2.6" />),
  sun: line(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>,
  ),
  moon: line(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />),
  lock: line(
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>,
  ),
  logout: line(
    <>
      <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" />
      <path d="M11 12h9M17 8.5l3.5 3.5-3.5 3.5" />
    </>,
  ),
};

/** Alert levels are carried by shape as well as colour: circle, triangle, octagon. */
export const LevelIcon = {
  advisory: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 7.2v4M8 4.7v.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  caution: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.9 14.7 13.6H1.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 6.3v3.4M8 11.6v.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.3 1.4h5.4l3.9 3.9v5.4l-3.9 3.9H5.3l-3.9-3.9V5.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 4.6v4.2M8 11.1v.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  ),
  ok: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8.5l3.2 3.2L13 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};
