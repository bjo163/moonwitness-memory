"use client";

import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "grid" | "archive" | "activity" | "brain" | "settings" | "sun" | "moon"
  | "upload" | "refresh" | "search" | "arrow-up-right" | "cloud" | "check"
  | "alert" | "arrow-right" | "folder" | "clock" | "external" | "terminal"
  | "spark" | "file" | "zap" | "close";

const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  archive: <><path d="M4 7h16v13H4z"/><path d="M3 4h18v3H3zM9 11h6"/></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
  brain: <><path d="M9 4a3 3 0 0 0-5.7 1.3A3.5 3.5 0 0 0 4 12a3.5 3.5 0 0 0 3 5.8A3 3 0 0 0 12 19V5a3 3 0 0 0-3-1Z"/><path d="M15 4a3 3 0 0 1 5.7 1.3A3.5 3.5 0 0 1 20 12a3.5 3.5 0 0 1-3 5.8A3 3 0 0 1 12 19V5a3 3 0 0 1 3-1Z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a8 8 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1 0 1.8Z"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
  moon: <path d="M20.9 13A8.8 8.8 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 16v4h16v-4"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.5-2L20 12M4 12l2.9 5a7 7 0 0 0 11.5-2"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
  "arrow-up-right": <><path d="M7 17 17 7M7 7h10v10"/></>,
  cloud: <path d="M7 18a5 5 0 0 1-.5-10A6.5 6.5 0 0 1 19 9.5 4.3 4.3 0 0 1 18 18Z"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  alert: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3v.1"/></>,
  "arrow-right": <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  folder: <><path d="M3 6h7l2 2h9v11H3z"/><path d="M3 9h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  external: <><path d="M14 4h6v6m0-6-9 9"/><path d="M18 13v6H4V5h6"/></>,
  terminal: <><path d="m4 7 5 5-5 5m8 0h8"/></>,
  spark: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
  file: <><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7m-7 4h7"/></>,
  zap: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
};

export function Icon({ name, size = 18, strokeWidth = 1.8, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
