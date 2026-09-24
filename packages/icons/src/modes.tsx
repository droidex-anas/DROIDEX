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

export const Sketch = createIcon(
  'sketch',
  <path d="M3.5 16.5c2.75-4.25 5.75-9.25 7.6-8.1 1.95 1.2-3.75 8.9-1.85 10.1 1.7 1.1 5.3-5.5 7.3-4.6 1.8.75-1.25 4.3.4 4.9 1.15.45 2.1-.35 3.5-2.25" />,
);
