import { createIcon } from './Icon.js';

const MIC_CRADLE = <path d="M5.75 10v1a6.25 6.25 0 0 0 12.5 0v-1M12 17.25v3.25" />;

export const Mic = createIcon(
  'mic',
  <>
    <rect x="9" y="3.25" width="6" height="10.5" rx="3" />
    {MIC_CRADLE}
  </>,
);

export const MicFilled = createIcon(
  'mic-filled',
  <>
    <rect x="9" y="3.25" width="6" height="10.5" rx="3" fill="currentColor" />
    {MIC_CRADLE}
  </>,
);

export const VoiceWave = createIcon(
  'voice-wave',
  <path d="M4.75 9.25v5.5M9.5 5v14M14.25 7.125v9.75M19 9.875v4.25" />,
);

// The filled form is the round voice-mode button: a disc with the bars cut out.
export const VoiceWaveFilled = createIcon(
  'voice-wave-filled',
  <path
    fill="currentColor"
    stroke="none"
    fillRule="evenodd"
    d="M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5ZM7.15 10.7a.6.6 0 0 1 1.2 0v2.6a.6.6 0 0 1-1.2 0Zm2.75-2.35a.6.6 0 0 1 1.2 0v7.3a.6.6 0 0 1-1.2 0Zm2.75 1.25a.6.6 0 0 1 1.2 0v4.8a.6.6 0 0 1-1.2 0Zm2.75 1.5a.6.6 0 0 1 1.2 0v1.8a.6.6 0 0 1-1.2 0Z"
  />,
);
