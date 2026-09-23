import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Mic, MicOff, X } from 'lucide-react';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { VoiceOrb } from './VoiceOrb';
import { voiceStatusLabel } from './voiceStatus';
import type { Voice } from './useVoice';

/** How many spoken lines stay on screen; the chat keeps the rest. */
const VISIBLE_LINES = 6;

const controlClass =
  'grid h-9 w-9 place-items-center rounded-full text-droid-text-secondary transition-colors hover:bg-droid-surface/70 hover:text-droid-text';

/**
 * The full-window voice surface: the orb, what is being said right now, and the
 * two controls a conversation needs while it runs. Which voice speaks and how
 * much it narrates are settings, not in-call controls, so they live in
 * Settings. The chat keeps every finished line; this holds only the last few.
 */
export function VoiceSurface({ voice }: { voice: Voice }) {
  if (voice.view !== 'full') return null;
  return createPortal(<VoiceSurfaceDialog voice={voice} />, document.body);
}

function VoiceSurfaceDialog({ voice }: { voice: Voice }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { session } = voice;
  useObscuresNativeSurfaces();

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Escape puts the chat back without hanging up, the way a call minimises.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      voice.minimize();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [voice]);

  const lines = session.lines.slice(-VISIBLE_LINES);

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Voice"
      tabIndex={-1}
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] flex flex-col bg-droid-bg/95 backdrop-blur-xl focus:outline-none"
    >
      <div className="flex items-center justify-end gap-1 px-3 pt-3">
        <button
          type="button"
          aria-label="Back to the chat"
          title="Back to the chat"
          onClick={voice.minimize}
          className={controlClass}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="End voice"
          title="End voice"
          onClick={voice.close}
          className={controlClass}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6">
        <VoiceOrb stream={session.micStream} size={220} />
        <p className="text-[13px] text-droid-text-muted">
          {voiceStatusLabel(session.status, session.muted, session.micDenied, session.error)}
        </p>

        <div className="flex min-h-0 w-full max-w-[640px] flex-col justify-end gap-2 overflow-hidden">
          {lines.map((line, index) => (
            <p
              key={line.id}
              className={`text-center text-[15px] leading-relaxed ${
                index === lines.length - 1 ? 'text-droid-text' : 'text-droid-text-muted'
              }`}
            >
              <span className="mr-2 text-[11px] uppercase tracking-wide text-droid-text-muted/70">
                {line.role === 'user' ? 'You' : 'Voice'}
              </span>
              {line.text}
            </p>
          ))}
        </div>
      </div>

      <div className="flex justify-center px-6 pb-10">
        <div className="flex items-center gap-2 rounded-2xl border border-droid-border/60 bg-droid-elevated p-2 shadow-droid">
          <button
            type="button"
            aria-label={session.muted ? 'Unmute' : 'Mute'}
            title={session.muted ? 'Unmute' : 'Mute'}
            aria-pressed={session.muted}
            onClick={session.toggleMuted}
            className={`grid h-9 w-9 place-items-center rounded-xl transition-colors ${
              session.muted
                ? 'bg-droid-surface text-droid-text'
                : 'text-droid-text-secondary hover:bg-droid-surface/70 hover:text-droid-text'
            }`}
          >
            {session.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={voice.close}
            className="ml-1 h-9 rounded-xl bg-droid-text px-4 text-[12px] font-medium text-droid-bg transition-opacity hover:opacity-90"
          >
            End
          </button>
        </div>
      </div>
    </motion.div>
  );
}
