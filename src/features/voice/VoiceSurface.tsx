import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Keyboard, Mic, MicOff, Settings2, X } from 'lucide-react';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { WINDOW_CONTROLS_INSET_PX } from '../../lib/windowChrome';
import { MessageBody } from '../../components/MessageBody';
import { SpokenMark } from '../../components/transcript/primitives';
import { UserBubble } from '../../components/transcript/UserBubble';
import { VoiceOrb } from './VoiceOrb';
import { VoiceSettingsSheet } from './VoiceSettingsSheet';
import { voiceStatusIsLive, voiceStatusLabel } from './voiceStatus';
import type { Voice } from './useVoice';

/** Full-window voice surface, portalled like every overlay in the app. */
export function VoiceSurface({ voice }: { voice: Voice }) {
  if (voice.view !== 'full') return null;
  return createPortal(<VoiceSurfaceDialog voice={voice} />, document.body);
}

const controlClass =
  'rounded-full p-2 text-droid-text-secondary transition-colors hover:bg-droid-bg/50 hover:text-droid-text';

function VoiceSurfaceDialog({ voice }: { voice: Voice }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { session } = voice;
  const live = session.status === 'live';
  useObscuresNativeSurfaces();

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Escape closes the settings first, then puts the chat back without hanging
  // up, the way a call minimises.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (settingsOpen) setSettingsOpen(false);
      else voice.minimize();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [settingsOpen, voice]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // The newest line stays in view as the conversation runs.
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [session.lines]);

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Voice mode"
      tabIndex={-1}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
      transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[1200] flex flex-col bg-droid-bg text-droid-text"
    >
      {/* The window controls sit over this row on macOS, so the label starts
          clear of them and the empty space still drags the window. */}
      <header
        data-electron-drag-region
        className="flex items-center py-4 pr-5"
        style={{ paddingLeft: WINDOW_CONTROLS_INSET_PX }}
      >
        <span className="text-[12px] font-medium text-droid-text-muted">Voice</span>
      </header>

      {/* What was said reads the way the chat reads: the same bubble for a
          request, the same message body for an answer, both marked as spoken. */}
      <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-4">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6">
          {session.lines.map((line) =>
            line.role === 'user' ? (
              <UserBubble key={line.id} event={{ text: line.text, spoken: true }} />
            ) : (
              <div key={line.id} className="min-w-0">
                <div className="mb-1.5">
                  <SpokenMark />
                </div>
                <MessageBody
                  text={line.text}
                  live={!line.final}
                  autoPlayAppBlocks={false}
                  cacheId={`voice-${String(line.id)}`}
                />
              </div>
            ),
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 pb-6 pt-4">
        {/* The orb's place is held while the connection is made, so the surface
            opens settled and the orb rises into it when the conversation opens. */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, scale: 0.82, y: 28 }}
          animate={
            reducedMotion
              ? { opacity: 1 }
              : { opacity: live ? 1 : 0.65, scale: live ? 1 : 0.82, y: live ? 0 : 28 }
          }
          transition={{ type: 'spring', stiffness: 260, damping: 24, mass: 0.9 }}
        >
          <VoiceOrb micStream={session.micStream} replyStream={session.replyStream} />
        </motion.div>
        <p
          className={`text-[13px] ${
            voiceStatusIsLive(session.status, session.muted, session.micDenied, session.error)
              ? 'shimmer-text font-medium'
              : 'text-droid-text-muted'
          }`}
          aria-live="polite"
        >
          {voiceStatusLabel(session.status, session.muted, session.micDenied, session.error)}
        </p>
      </div>

      <div className="flex justify-center px-4" style={{ paddingBottom: 40 }}>
        <div className="flex items-center gap-1 rounded-full border border-droid-border bg-droid-raised p-1.5 shadow-droid">
          <button
            type="button"
            onClick={voice.minimize}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-bg/50 hover:text-droid-text"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Type
          </button>
          <button
            type="button"
            onClick={session.toggleMuted}
            aria-pressed={session.muted}
            aria-label={session.muted ? 'Unmute microphone' : 'Mute microphone'}
            title={session.muted ? 'Unmute' : 'Mute'}
            className={controlClass}
          >
            {session.muted ? (
              <MicOff className="h-3.5 w-3.5 text-droid-red" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen((open) => !open);
            }}
            aria-expanded={settingsOpen}
            aria-label="Voice settings"
            title="Voice settings"
            className={controlClass}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={voice.minimize}
            aria-label="Minimize to composer"
            title="Minimize to composer"
            className={controlClass}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={voice.close}
            aria-label="End voice mode"
            title="End voice mode"
            className="rounded-full bg-droid-accent p-2 text-droid-bg transition-opacity hover:opacity-90"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {settingsOpen && (
          <VoiceSettingsSheet
            voices={session.voices}
            defaultVoice={session.defaultVoice}
            onVoiceChanged={voice.restart}
            onClose={() => {
              setSettingsOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
