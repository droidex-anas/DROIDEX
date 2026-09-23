import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Mic, MicOff, Settings2, X } from 'lucide-react';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { MessageBody } from '../../components/MessageBody';
import { SpokenMark } from '../../components/transcript/primitives';
import { UserBubble } from '../../components/transcript/UserBubble';
import { VoiceOrb } from './VoiceOrb';
import { VoiceSettingsSheet } from './VoiceSettingsSheet';
import { voiceStatusLabel } from './voiceStatus';
import type { Voice } from './useVoice';

const ORB_SIZE = 168;

const controlClass =
  'grid h-9 w-9 place-items-center rounded-full text-droid-text-secondary transition-colors hover:bg-droid-surface/70 hover:text-droid-text';

/**
 * The full-window voice surface. What was said reads the way the chat reads —
 * the same bubble for a request, the same message body for an answer, each
 * carrying the spoken mark — because it is the same conversation. The orb waits
 * off its mark while the connection is made and rises into place when the
 * conversation is open, so the first word never arrives unannounced.
 */
export function VoiceSurface({ voice }: { voice: Voice }) {
  if (voice.view !== 'full') return null;
  return createPortal(<VoiceSurfaceDialog voice={voice} />, document.body);
}

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

      <div className="flex flex-col items-center gap-3 pt-2">
        {/* The orb's place is held while the conversation connects, so the
            surface opens settled and the orb lands in it. */}
        <div className="relative grid place-items-center" style={{ height: ORB_SIZE }}>
          <div
            aria-hidden
            className="absolute rounded-full border border-droid-border/60 transition-opacity duration-300"
            style={{ height: ORB_SIZE, width: ORB_SIZE, opacity: live ? 0 : 1 }}
          />
          <motion.div
            initial={reducedMotion ? false : { y: 28, scale: 0.82, opacity: 0.6 }}
            animate={
              reducedMotion
                ? { opacity: 1 }
                : { y: live ? 0 : 28, scale: live ? 1 : 0.82, opacity: live ? 1 : 0.6 }
            }
            transition={{ type: 'spring', stiffness: 260, damping: 24, mass: 0.9 }}
          >
            <VoiceOrb
              micStream={session.micStream}
              replyStream={session.replyStream}
              size={ORB_SIZE}
            />
          </motion.div>
        </div>
        <p className="text-[13px] text-droid-text-muted" aria-live="polite">
          {voiceStatusLabel(session.status, session.muted, session.micDenied, session.error)}
        </p>
      </div>

      <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
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

      <div className="flex justify-center px-6 pb-10">
        <div className="flex items-center gap-1 rounded-2xl border border-droid-border/60 bg-droid-elevated p-1.5 shadow-droid">
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
            aria-label="Voice settings"
            title="Voice settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsOpen((open) => !open);
            }}
            className={`grid h-9 w-9 place-items-center rounded-xl transition-colors ${
              settingsOpen
                ? 'bg-droid-surface text-droid-text'
                : 'text-droid-text-secondary hover:bg-droid-surface/70 hover:text-droid-text'
            }`}
          >
            <Settings2 className="h-4 w-4" />
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

      <AnimatePresence>
        {settingsOpen && (
          <VoiceSettingsSheet
            voices={session.voices}
            defaultVoice={session.defaultVoice}
            onClose={() => {
              setSettingsOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
