// Flat, single-colour line icons (inherit colour via currentColor).
const Svg = ({ children, size = 24, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);

export const BoxIcon = (p) => (
  <Svg {...p}>
    <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </Svg>
);
export const ChartIcon = (p) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);
export const UsersIcon = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.3c2.3.7 3.5 2.6 3.5 5.7" />
  </Svg>
);
export const StoreIcon = (p) => (
  <Svg {...p}>
    <path d="M3 9l1.5-5h15L21 9M3 9v0a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M5 12v8h14v-8" />
    <path d="M10 20v-5h4v5" />
  </Svg>
);
export const CameraIcon = (p) => (
  <Svg {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);
export const CheckIcon = (p) => (
  <Svg strokeWidth="2.6" {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const ClipboardIcon = (p) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4.5h6V3H9v1.5zM8.5 10h7M8.5 14h7M8.5 17.5h4" />
  </Svg>
);
export const PencilIcon = (p) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3zM14 7l3 3" />
  </Svg>
);
export const TrashIcon = (p) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const GearIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </Svg>
);
export const HistoryIcon = (p) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 103-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </Svg>
);
export const UploadIcon = (p) => (
  <Svg {...p}>
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
    <path d="M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" />
  </Svg>
);
