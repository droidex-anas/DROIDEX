import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Keyboard, Mic, MicOff, X } from 'lucide-react';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { voiceStatusLabel, type VoiceMode } from './useVoiceMode';
import { VoiceOrb } from './VoiceOrb';

/** Full-window voice surface, portalled like every overlay in the app. */
export function VoiceModeOverlay({ voice }: { voice: VoiceMode }) {
  if (voice.view !== 'full') return null;
  return createPortal(<VoiceModeDialog voice={voice} />, document.body);
}

const controlClass =
  'rounded-full p-2 text-droid-text-secondary transition-colors hover:bg-droid-bg/50 hover:text-droid-text';

function VoiceModeDialog({ voice }: { voice: VoiceMode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useObscuresNativeSurfaces();

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Same dialog contract as the image lightbox: Escape closes, Tab cycles
  // inside, and the app behind does not scroll while voice owns the window.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        voice.stop();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])'),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [voice]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Voice mode"
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[1200] flex flex-col bg-droid-bg text-droid-text"
    >
      <header className="flex items-center px-5 py-4">
        <span className="text-[12px] font-medium text-droid-text-muted">Voice</span>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <VoiceOrb stream={voice.micStream} />
        </motion.div>
        <p className="text-[13px] text-droid-text-muted">
          {voiceStatusLabel(voice.muted, voice.micDenied)}
        </p>
      </div>
      <div className="flex justify-center px-4 pb-10">
        <div className="flex items-center gap-1 rounded-full border border-droid-border bg-droid-elevated p-1.5 shadow-droid">
          <button
            type="button"
            onClick={voice.stop}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-bg/50 hover:text-droid-text"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Type
          </button>
          <button
            type="button"
            onClick={voice.toggleMuted}
            aria-pressed={voice.muted}
            aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
            title={voice.muted ? 'Unmute' : 'Mute'}
            className={controlClass}
          >
            {voice.muted ? (
              <MicOff className="h-3.5 w-3.5 text-droid-red" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={voice.showCompact}
            aria-label="Minimize to composer"
            title="Minimize to composer"
            className={controlClass}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={voice.stop}
            aria-label="End voice mode"
            title="End voice mode"
            className="rounded-full bg-droid-accent p-2 text-droid-bg transition-opacity hover:opacity-90"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
