import { createIcon } from './Icon.js';

export const ComputerUse = createIcon(
  'computer-use',
  <path d="M5.6 4.2a1 1 0 0 0-1.3 1.3l5.2 13.3a1 1 0 0 0 1.9-.1l1.4-5.4 5.4-1.4a1 1 0 0 0 .1-1.9Z" />,
);

export const ComputerHistory = createIcon(
  'computer-history',
  <>
    <path d="M8.9 8.4a.7.7 0 0 1 .9-.9l7.3 2.9a.7.7 0 0 1 0 1.3l-3 .9-.9 3a.7.7 0 0 1-1.3 0Z" />
    <path d="M12 4.5v-2m5.3 4.2 1.4-1.4m.8 6.7h2m-4.2 5.3 1.4 1.4M12 19.5v2m-5.3-4.2-1.4 1.4M4.5 12h-2m4.2-5.3L5.3 5.3" />
  </>,
);

export const Appshots = createIcon(
  'appshots',
  <>
    <path d="M3.5 9.5v-1a3 3 0 0 1 3-3H8m8 0h1.5a3 3 0 0 1 3 3v1m0 5v1a3 3 0 0 1-3 3H16m-8 0H6.5a3 3 0 0 1-3-3v-1" />
    <path d="M10.5 5.5h.01m2.99 0h.01m-3.01 13h3" />
  </>,
);

export const Plugins = createIcon(
  'plugins',
  <>
    <circle cx="12" cy="12" r="3.25" />
    <path d="M15.25 9v4.25a2.5 2.5 0 0 0 5 0V12a8.25 8.25 0 1 0-3.4 6.7" />
  </>,
);

export const Browser = createIcon(
  'browser',
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="4" />
    <path d="M7.5 8.75h9" />
  </>,
);
