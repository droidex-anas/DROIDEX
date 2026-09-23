import { Dropdown } from '../../components/settingsKit';
import type { VoiceNarration } from '../../types/bridge';

const HARNESS_DEFAULT = 'default';

const NARRATION: { value: VoiceNarration; label: string; title: string }[] = [
  { value: 'brief', label: 'Brief', title: 'Says it is working, then reports the result' },
  { value: 'commentary', label: 'Narrate', title: 'Talks through the work as it happens' },
];

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The two choices that belong to a conversation rather than to the chat: which
 * voice speaks, and how much of the work it narrates. The voices are the ones
 * the harness published for this session, so the list is empty until it
 * answers and the picker then stands on the harness default.
 */
export function VoiceControls({
  voices,
  defaultVoice,
  selectedVoice,
  onVoiceChange,
  narration,
  onNarrationChange,
}: {
  voices: string[];
  defaultVoice?: string;
  selectedVoice?: string;
  onVoiceChange: (voice: string) => void;
  narration: VoiceNarration;
  onNarrationChange: (narration: VoiceNarration) => void;
}) {
  const options = [
    {
      value: HARNESS_DEFAULT,
      label: defaultVoice ? `Default · ${capitalize(defaultVoice)}` : 'Default voice',
    },
    ...voices.map((voice) => ({ value: voice, label: capitalize(voice) })),
  ];

  return (
    <>
      <Dropdown
        ariaLabel="Voice"
        value={selectedVoice && voices.includes(selectedVoice) ? selectedVoice : HARNESS_DEFAULT}
        options={options}
        width="w-44"
        onChange={(value) => {
          onVoiceChange(value === HARNESS_DEFAULT ? '' : value);
        }}
      />

      <div
        role="radiogroup"
        aria-label="While it works"
        className="flex gap-0.5 rounded-xl bg-droid-bg/60 p-0.5"
      >
        {NARRATION.map((option) => {
          const selected = option.value === narration;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={option.title}
              onClick={() => {
                onNarrationChange(option.value);
              }}
              className={`h-8 rounded-[10px] px-3 text-[12px] font-medium transition-colors ${
                selected
                  ? 'bg-droid-surface text-droid-text'
                  : 'text-droid-text-muted hover:text-droid-text'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
