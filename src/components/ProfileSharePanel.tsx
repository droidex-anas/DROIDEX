import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, ImageDown, RefreshCw, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { downloadProfileCard, profileCardBlob } from '../features/profile/profileCard';
import type { PublicProfileSnapshot } from '../features/profile/profileShare';
import { ghostButton, primaryButton, secondaryButton } from './buttonStyles';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type ProfileMutation = 'publish' | 'update' | 'unpublish' | null;

function IconSwap({
  swapped,
  icon,
  swappedIcon,
}: {
  swapped: boolean;
  icon: ReactNode;
  swappedIcon: ReactNode;
}) {
  return (
    <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
      <AnimatePresence initial={false}>
        <motion.span
          key={swapped ? 'on' : 'off'}
          className="absolute inline-flex"
          initial={{ opacity: 0, scale: 0.7, filter: 'blur(2px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.7, filter: 'blur(2px)' }}
          transition={{ duration: 0.15 }}
        >
          {swapped ? swappedIcon : icon}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function ProfileSharePanel({
  url,
  snapshot,
  published,
  mutation,
  updateBlocked,
  mutationError,
  onPublish,
  onUpdate,
  onUnpublish,
  onClose,
}: {
  url: string;
  snapshot: PublicProfileSnapshot;
  published: boolean;
  mutation: ProfileMutation;
  updateBlocked: string;
  mutationError: string;
  onPublish: () => void;
  onUpdate: () => void;
  onUnpublish: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState('');
  const [savingImage, setSavingImage] = useState(false);
  const [localError, setLocalError] = useState('');
  const busy = mutation !== null;

  useEffect(() => {
    let objectUrl = '';
    let active = true;
    setPreview('');
    void profileCardBlob(snapshot)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview(objectUrl);
      })
      .catch((cause: unknown) => {
        if (active)
          setLocalError(
            cause instanceof Error ? cause.message : 'Could not render the profile card.',
          );
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [snapshot]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1400);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = () => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setLocalError('');
      })
      .catch(() => {
        setLocalError('Could not copy the link. Select it and copy it manually.');
      });
  };
  const download = async () => {
    setSavingImage(true);
    setLocalError('');
    try {
      await downloadProfileCard(snapshot);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Could not render the profile card.');
    } finally {
      setSavingImage(false);
    }
  };

  return (
    <motion.section
      aria-label={published ? 'Published profile' : 'Publish your profile'}
      className="relative mt-3 grid gap-5 rounded-2xl bg-droid-surface p-4 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      <div className="relative aspect-[1200/630] overflow-hidden rounded-xl bg-droid-elevated">
        <AnimatePresence>
          {preview && (
            <motion.img
              key={preview}
              src={preview}
              alt="Preview of your shareable profile card"
              className="absolute inset-0 h-full w-full"
              initial={{ opacity: 0, scale: 1.03, filter: 'blur(6px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.4, ease: EASE }}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-medium text-droid-text">
              {published ? 'Your profile is public' : 'Publish your profile'}
            </h3>
            <p className="mt-1 text-[11px] leading-[18px] text-droid-text-muted">
              {published
                ? 'Update it when you want to publish your latest local totals.'
                : 'Preview the aggregate usage that will appear on your public page.'}
            </p>
          </div>
          <button
            aria-label="Close sharing"
            className={`${ghostButton} -mr-1 -mt-1 w-8 px-0`}
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {published ? (
            <>
              <div className="flex gap-2">
                <button className={`${primaryButton} flex-1`} onClick={copy}>
                  <IconSwap
                    swapped={copied}
                    icon={<Copy size={13} />}
                    swappedIcon={<Check size={13} />}
                  />
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  className={secondaryButton}
                  disabled={savingImage}
                  onClick={() => void download()}
                >
                  <ImageDown size={13} />
                  {savingImage ? 'Rendering…' : 'Save image'}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  className={`${secondaryButton} flex-1`}
                  disabled={busy || updateBlocked !== ''}
                  title={updateBlocked || undefined}
                  onClick={onUpdate}
                >
                  <RefreshCw size={13} className={mutation === 'update' ? 'animate-spin' : ''} />
                  {mutation === 'update' ? 'Updating…' : 'Update profile'}
                </button>
                <button
                  className={`${ghostButton} text-droid-red hover:text-droid-red`}
                  disabled={busy}
                  onClick={onUnpublish}
                >
                  <Trash2 size={13} />
                  {mutation === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                className={`${primaryButton} flex-1`}
                disabled={busy || updateBlocked !== ''}
                title={updateBlocked || undefined}
                onClick={onPublish}
              >
                <Send size={13} />
                {mutation === 'publish' ? 'Publishing…' : 'Publish profile'}
              </button>
              <button
                className={secondaryButton}
                disabled={savingImage}
                onClick={() => void download()}
              >
                <ImageDown size={13} />
                {savingImage ? 'Rendering…' : 'Save image'}
              </button>
            </div>
          )}
          <input
            aria-label="Profile link"
            readOnly
            value={url}
            onFocus={(event) => {
              event.target.select();
            }}
            className="h-8 w-full truncate rounded-lg bg-droid-elevated px-2.5 text-[12px] text-droid-text-secondary focus:outline-none focus-visible:bg-droid-active"
          />
        </div>

        <p className="mt-auto flex gap-1.5 pt-4 text-[11px] leading-[18px] text-droid-text-muted">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          {published
            ? 'Public: display name, username, aggregate token activity, DROIDEX session count, streaks and harness/model names. Never prompts, responses, chats, files, paths, costs or device data. Public until you unpublish; downloads and screenshots cannot be recalled.'
            : 'Publishes your display name, username, aggregate token activity, DROIDEX session count, streaks and harness/model names—never prompts, responses, chats, files, paths, costs or device data. The page stays public until you unpublish it.'}
        </p>
        {(mutationError || localError) && (
          <p role="alert" className="mt-2 text-[11px] leading-5 text-droid-red">
            {mutationError || localError}
          </p>
        )}
      </div>
    </motion.section>
  );
}
