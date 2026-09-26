import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import type { VoiceNarration } from '../../types/bridge';

const HARNESS_DEFAULT = '';

const NARRATION: { value: VoiceNarration; label: string; hint: string }[] = [
  { value: 'brief', label: 'Brief', hint: 'Says it is working, then reports back' },
  { value: 'commentary', label: 'Narrate', hint: 'Talks through the work as it runs' },
];

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The conversation's settings, reachable without leaving it. They are the same
 * two the Settings panel holds, so a change here is a change there. Both are
 * chosen when a conversation opens, so changing either reconnects: the sheet
 * says so rather than letting the old voice, or the old narration, carry on.
 */
export function VoiceSettingsSheet({
  voices,
  defaultVoice,
  onClose,
}: {
  voices: string[];
  defaultVoice?: string;
  onClose: () => void;
}) {
  const dispatch = useStoreDispatch();
  const reducedMotion = useReducedMotion();
  const selectedVoice = useStoreSelector((state) => state.defaultVoice);
  const narration = useStoreSelector((state) => state.narrationMode);

  const chooseVoice = (voice: string) => {
    if (voice === selectedVoice) return;
    dispatch({ type: 'SET_DEFAULT_VOICE', voice });
  };

  const chooseNarration = (mode: VoiceNarration) => {
    if (mode === narration) return;
    dispatch({ type: 'SET_NARRATION_MODE', mode });
  };

  return (
    <div
      className="absolute inset-0 z-10 flex items-end justify-center pb-28"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        role="dialog"
        aria-label="Voice settings"
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-droid-border/60 bg-droid-elevated shadow-droid"
      >
        <div className="px-4 pt-3.5 pb-2 text-[12px] font-medium text-droid-text-secondary">
          Voice
        </div>
        <div
          role="radiogroup"
          aria-label="Voice"
          className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5"
        >
          <VoiceRow
            label={defaultVoice ? `Default · ${capitalize(defaultVoice)}` : 'Harness default'}
            selected={selectedVoice === HARNESS_DEFAULT}
            onSelect={() => {
              chooseVoice(HARNESS_DEFAULT);
            }}
          />
          {voices.map((voice) => (
            <VoiceRow
              key={voice}
              label={capitalize(voice)}
              selected={selectedVoice === voice}
              onSelect={() => {
                chooseVoice(voice);
              }}
            />
          ))}
        </div>

        <div className="border-t border-droid-border/60 px-4 py-3">
          <div className="mb-2 text-[12px] font-medium text-droid-text-secondary">
            While it works
          </div>
          <div role="radiogroup" aria-label="While it works" className="flex flex-col gap-1">
            {NARRATION.map((option) => {
              const selected = option.value === narration;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    chooseNarration(option.value);
                  }}
                  className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    selected ? 'bg-droid-surface' : 'hover:bg-droid-surface/60'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] text-droid-text">{option.label}</span>
                    <span className="block text-[11px] leading-snug text-droid-text-muted">
                      {option.hint}
                    </span>
                  </span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0 text-droid-accent" />}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-snug text-droid-text-muted">
            A new voice, or a new way of narrating, takes over after a short reconnect.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function VoiceRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
        selected
          ? 'bg-droid-surface text-droid-text'
          : 'text-droid-text-secondary hover:bg-droid-surface/60 hover:text-droid-text'
      }`}
    >
      {label}
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-droid-accent" />}
    </button>
  );
}
