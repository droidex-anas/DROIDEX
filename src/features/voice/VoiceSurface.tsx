import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Keyboard, Mic, MicOff, Settings2, X } from 'lucide-react';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { WINDOW_CONTROLS_INSET_PX } from '../../lib/windowChrome';
import { pushEscapeLayer } from '../../components/environment/usePopover';
import AskUserInline from '../../components/AskUserInline';
import { MessageBody } from '../../components/MessageBody';
import PermissionInline from '../../components/PermissionInline';
import { SpokenMark } from '../../components/transcript/primitives';
import { UserBubble } from '../../components/transcript/UserBubble';
import { VoiceOrb } from './VoiceOrb';
import { VoiceSettingsSheet } from './VoiceSettingsSheet';
import { voiceStatusIsLive, voiceStatusLabel } from './voiceStatus';
import { useVoiceTranscript } from './useVoiceTranscript';
import type { Voice } from './useVoice';
import type { VoiceTranscriptLine } from './voiceSessions';

/** Full-window voice surface, portalled like every overlay in the app. */
export function VoiceSurface({ voice, appSessionId }: { voice: Voice; appSessionId: string }) {
  return createPortal(
    <VoiceSurfaceDialog voice={voice} appSessionId={appSessionId} />,
    document.body,
  );
}

// What a round of Tab visits inside the surface.
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex="0"]';

const controlClass =
  'rounded-full p-2 text-droid-text-secondary transition-colors hover:bg-droid-bg/50 hover:text-droid-text';

function VoiceSurfaceDialog({ voice, appSessionId }: { voice: Voice; appSessionId: string }) {
  const dialogRef = useRef<HTMLDivElement>(null);
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

  // The surface covers the app, so Tab stays inside it: `aria-modal` says the
  // rest is inert but does nothing about the focus ring. The settings sheet is
  // rendered within the dialog, so its controls are part of the same round.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (event.key !== 'Tab' || !dialog) return;
      const stops = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === dialog,
      );
      const first = stops.at(0);
      const last = stops.at(-1);
      if (!first || !last) return;
      // Focus starts on the dialog itself, and can sit outside it entirely, so
      // anything that is not one of the stops enters at the near end rather
      // than letting Tab walk into the app behind.
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && stops.includes(active);
      if (inside && active !== (event.shiftKey ? first : last)) return;
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Escape closes the settings first, then puts the chat back without hanging
  // up, the way a call minimises. Two layers on the app's Escape stack, so the
  // keystroke never also reaches the composer underneath.
  const minimize = voice.minimize;
  useEffect(() => pushEscapeLayer(minimize), [minimize]);
  useEffect(() => {
    if (!settingsOpen) return;
    return pushEscapeLayer(() => {
      setSettingsOpen(false);
    });
  }, [settingsOpen]);

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
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.01 }}
      transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[1200] flex flex-col bg-droid-bg text-droid-text"
    >
      {/* Nothing is titled here: the orb is the subject. The row exists so the
          window can be dragged and so the macOS controls have their space. */}
      <header
        data-electron-drag-region
        className="h-10 shrink-0"
        style={{ paddingLeft: WINDOW_CONTROLS_INSET_PX }}
      />

      <SpokenFeed appSessionId={appSessionId} />

      {/* The agent can stop and ask while the conversation holds the screen.
          It asks with the app's own cards, in the same place the composer
          would have shown them, rather than behind this surface. */}
      <div className="mx-auto max-h-[35vh] w-full max-w-[680px] shrink-0 overflow-y-auto px-6">
        <PermissionInline />
        <AskUserInline />
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
            voiceStatusIsLive(voice.activity) ? 'shimmer-text font-medium' : 'text-droid-text-muted'
          }`}
          aria-live="polite"
        >
          {voiceStatusLabel(voice.activity)}
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
            onClose={() => {
              setSettingsOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * What was said reads the way the chat reads: the same bubble for a request,
 * the same message body for an answer, both marked as spoken. Only this part
 * of the surface re-renders as the words arrive.
 */
function SpokenFeed({ appSessionId }: { appSessionId: string }) {
  const lines = useVoiceTranscript(appSessionId);
  const feedRef = useRef<HTMLDivElement>(null);

  // The newest line stays in view as the conversation runs.
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [lines]);

  return (
    <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-4">
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6">
        {lines.map((line) => (
          <SpokenLine key={line.id} line={line} />
        ))}
      </div>
    </div>
  );
}

// A line keeps its object until its own words change, so the lines already
// said skip rendering while the newest one grows.
const SpokenLine = memo(function SpokenLine({ line }: { line: VoiceTranscriptLine }) {
  if (line.role === 'user') return <UserBubble event={{ text: line.text, spoken: true }} />;
  return (
    <div className="min-w-0">
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
  );
});
