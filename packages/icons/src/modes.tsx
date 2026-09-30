import { createIcon } from './Icon.js';

const BULB = 'M9.5 16.25c0-1-.5-1.75-1.2-2.45a5 5 0 1 1 7.4 0c-.7.7-1.2 1.45-1.2 2.45Z';
const BULB_BASE_AND_RAYS = (
  <path d="M9.75 18.75h4.5m-3.5 2.25h2.5M12 2v1M5.6 4.6l.7.7m12.1-.7-.7.7M3 10.5h1m16 0h1" />
);

export const Lightbulb = createIcon(
  'lightbulb',
  <>
    <path d={BULB} />
    {BULB_BASE_AND_RAYS}
  </>,
);

export const LightbulbFilled = createIcon(
  'lightbulb-filled',
  <>
    <path d={BULB} fill="currentColor" />
    {BULB_BASE_AND_RAYS}
  </>,
);

export const Brain = createIcon(
  'brain',
  <>
    <path d="M12 5.5a2.75 2.75 0 0 0-5.1-1.4A2.75 2.75 0 0 0 4.4 7.9a3.1 3.1 0 0 0-.3 5.4 3 3 0 0 0 2.4 4.3A2.75 2.75 0 0 0 12 18.6" />
    <path d="M12 5.5a2.75 2.75 0 0 1 5.1-1.4 2.75 2.75 0 0 1 2.5 3.8 3.1 3.1 0 0 1 .3 5.4 3 3 0 0 1-2.4 4.3A2.75 2.75 0 0 1 12 18.6V5.5" />
    <path d="M7.25 10.5a2.25 2.25 0 0 0 2.25-2.25m7.25 2.25a2.25 2.25 0 0 1-2.25-2.25M8 14.5h1.25A1.75 1.75 0 0 1 11 16.25m5-1.75h-1.25A1.75 1.75 0 0 0 13 16.25" />
  </>,
);

export const Models = createIcon(
  'models',
  <>
    <circle cx="12" cy="7" r="3.25" fill="currentColor" fillOpacity={0.3} />
    <circle cx="6.9" cy="16.1" r="3.25" />
    <circle cx="17.1" cy="16.1" r="3.25" />
  </>,
);

export const Sketch = createIcon(
  'sketch',
  <path d="M3.5 16.5c2.75-4.25 5.75-9.25 7.6-8.1 1.95 1.2-3.75 8.9-1.85 10.1 1.7 1.1 5.3-5.5 7.3-4.6 1.8.75-1.25 4.3.4 4.9 1.15.45 2.1-.35 3.5-2.25" />,
);

// The four permission modes, drawn to read at 14px beside an 11px label: an
// eye that watches, a pen whose edits go through, the shield that checks
// routine actions, and a key to everything.
export const Supervised = createIcon(
  'supervised',
  <>
    <path d="M3 10.8C5 7.7 8.2 5.5 12 5.5s7 2.2 9 5.3c.45.72.45 1.68 0 2.4-2 3.1-5.2 5.3-9 5.3s-7-2.2-9-5.3c-.45-.72-.45-1.68 0-2.4Z" />
    <circle cx="12" cy="12" r="2.7" fill="currentColor" stroke="none" />
  </>,
);

export const AcceptEdits = createIcon(
  'accept-edits',
  <g transform="translate(0 0.35) rotate(-45 12 12)">
    <path d="M19.5 9.2H8.5Q5.2 9.2 1.7 12Q5.2 14.8 8.5 14.8H19.5a2.8 2.8 0 0 0 0-5.6Z" />
    <path d="M8.5 9.2v5.6" />
  </g>,
);

export const AutoApprove = createIcon(
  'auto-approve',
  <>
    <path d="M10.5 3.6 6 5.35c-.95.37-1.4 1.05-1.4 2.1v4.05c0 4.15 2.6 7.3 5.9 8.95 1 .5 1.95.5 2.95 0 3.3-1.65 5.9-4.8 5.9-8.95V7.45c0-1.05-.45-1.73-1.4-2.1L13.45 3.6c-1-.4-1.95-.4-2.95 0Z" />
    <path d="m8.8 12 2.25 2.25 4.1-4.2" />
  </>,
);

export const FullAccess = createIcon(
  'full-access',
  <>
    <circle cx="7.8" cy="11.75" r="5.6" />
    <path d="M13.4 11.75H21.2v3.3" />
    <path d="M16.6 11.75v2.6" />
  </>,
);
