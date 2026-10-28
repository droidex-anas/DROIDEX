import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, RefreshCw, Send, ShieldCheck, Trash, X } from '@droidex/icons';
import { ImageDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { downloadProfileCard, profileCardBlob } from '../features/profile/profileCard';
import type { PublicProfileSnapshot } from '../features/profile/profileShare';
import { Button } from './ui/Button';

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
    <span className="relative inline-flex size-icon-md shrink-0 items-center justify-center">
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
      className="profile-share-panel relative mt-3 grid gap-5 rounded-xl bg-surface p-4"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      <div className="profile-card-preview relative overflow-hidden rounded-lg bg-elevated">
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
            <h3 className="text-body-strong text-primary">
              {published ? 'Your profile is public' : 'Publish your profile'}
            </h3>
            <p className="mt-1 text-caption text-muted">
              {published
                ? 'Update it when you want to publish your latest local totals.'
                : 'Preview the aggregate usage that will appear on your public page.'}
            </p>
          </div>
          <Button
            variant="ghost"
            icon={X}
            aria-label="Close sharing"
            className="-mr-1 -mt-1"
            disabled={busy}
            onClick={onClose}
          />
        </div>

        <div className="mt-4 space-y-2">
          {published ? (
            <>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={copy}
                  icon={
                    <IconSwap
                      swapped={copied}
                      icon={<Copy className="size-icon-md" aria-hidden="true" />}
                      swappedIcon={<Check className="size-icon-md" aria-hidden="true" />}
                    />
                  }
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
                <Button icon={ImageDown} disabled={savingImage} onClick={() => void download()}>
                  {savingImage ? 'Rendering…' : 'Save image'}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={busy || updateBlocked !== ''}
                  title={updateBlocked || undefined}
                  onClick={onUpdate}
                  icon={
                    <RefreshCw
                      className={`size-icon-md shrink-0 ${mutation === 'update' ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                  }
                >
                  {mutation === 'update' ? 'Updating…' : 'Update profile'}
                </Button>
                <Button variant="danger" icon={Trash} disabled={busy} onClick={onUnpublish}>
                  {mutation === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="primary"
                icon={Send}
                className="flex-1"
                disabled={busy || updateBlocked !== ''}
                title={updateBlocked || undefined}
                onClick={onPublish}
              >
                {mutation === 'publish' ? 'Publishing…' : 'Publish profile'}
              </Button>
              <Button icon={ImageDown} disabled={savingImage} onClick={() => void download()}>
                {savingImage ? 'Rendering…' : 'Save image'}
              </Button>
            </div>
          )}
          <input
            aria-label="Profile link"
            readOnly
            value={url}
            onFocus={(event) => {
              event.target.select();
            }}
            className="h-control-md w-full truncate rounded-md bg-elevated px-2.5 text-body text-secondary"
          />
        </div>

        <p className="mt-auto flex gap-1.5 pt-4 text-caption text-muted">
          <ShieldCheck className="mt-px size-icon-sm shrink-0" aria-hidden="true" />
          {published
            ? 'Public: display name, username, aggregate token activity, DROIDEX session count, streaks and harness/model names. Never prompts, responses, chats, files, paths, costs or device data. Public until you unpublish; downloads and screenshots cannot be recalled.'
            : 'Publishes your display name, username, aggregate token activity, DROIDEX session count, streaks and harness/model names—never prompts, responses, chats, files, paths, costs or device data. The page stays public until you unpublish it.'}
        </p>
        {(mutationError || localError) && (
          <p role="alert" className="mt-2 text-caption text-danger">
            {mutationError || localError}
          </p>
        )}
      </div>
    </motion.section>
  );
}
