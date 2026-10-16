import { useEffect, useRef, useState } from 'react';
import {
  Bug,
  Check,
  CircleCheck,
  Copy,
  Ellipsis,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
  type IconComponent,
} from '@droidex/icons';
import type { FeedbackAttachments, FeedbackCategory, FeedbackReportRequest } from '../lib/desktop';
import { submitFeedbackReport } from '../lib/feedbackReport';
import { Button } from './ui/Button';
import { Dialog, DialogActions, DialogBody, DialogTitle } from './ui/Dialog';
import { Input } from './ui/Field';

const CATEGORIES: {
  value: FeedbackCategory;
  label: string;
  icon: IconComponent;
}[] = [
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'bad_result', label: 'Bad result', icon: ThumbsDown },
  { value: 'good_result', label: 'Good result', icon: ThumbsUp },
  { value: 'safety', label: 'Safety', icon: ShieldCheck },
  { value: 'other', label: 'Other', icon: Ellipsis },
];

const ATTACHMENTS = [
  ['sessionLog', 'Recent session log'],
  ['screenshot', 'Screenshot'],
  ['appState', 'App state'],
] as const;

interface FeedbackModalProps {
  initialReport: FeedbackReportRequest;
  onClose: () => void;
}

export function FeedbackModal({ initialReport, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState(initialReport.category);
  const [description, setDescription] = useState(initialReport.description);
  const [attachments, setAttachments] = useState<FeedbackAttachments>({
    sessionLog: true,
    screenshot: false,
    appState: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState('');
  const [copied, setCopied] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const reportIdRef = useRef<HTMLInputElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, 1_800);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [copied]);

  useEffect(() => {
    if (reportId) copyButtonRef.current?.focus();
  }, [reportId]);

  const submit = async () => {
    const details = description.trim();
    if (details.length < 5 || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const receipt = await submitFeedbackReport({ category, description: details, attachments });
      setReportId(receipt.reportId);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'The report could not be delivered.',
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const copyReportId = async () => {
    try {
      await navigator.clipboard.writeText(reportId);
      setError('');
      setCopied(true);
    } catch {
      setError('Copy failed. Select the report ID and copy it manually.');
      reportIdRef.current?.focus();
      reportIdRef.current?.select();
    }
  };

  const errorNote = error && (
    <p role="alert" className="mt-3 text-body text-danger">
      {error}
    </p>
  );

  return (
    <Dialog
      size="form"
      onClose={onClose}
      dismissible={!submitting}
      initialFocusRef={descriptionRef}
      aria-busy={submitting}
    >
      {reportId ? (
        <div aria-live="polite">
          <CircleCheck className="size-icon-lg text-success" aria-hidden="true" />
          <DialogTitle className="mt-3">Report accepted</DialogTitle>
          <p className="mt-1 text-body text-secondary">
            Keep this report ID if you need to follow up with support.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Input
              ref={reportIdRef}
              aria-label="Report ID"
              readOnly
              value={reportId}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className="font-mono"
            />
            <Button
              ref={copyButtonRef}
              size="lg"
              icon={copied ? Check : Copy}
              onClick={() => void copyReportId()}
            >
              {copied ? 'Copied' : 'Copy ID'}
            </Button>
          </div>
          {errorNote}
          <DialogActions>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </DialogActions>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>Share feedback</DialogTitle>
              <p className="mt-1 text-body text-secondary">
                Tell us what happened. A report ID will be created when delivery succeeds.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={onClose}
              disabled={submitting}
              aria-label="Close feedback"
              className="-mr-2 -mt-1"
            />
          </div>

          <DialogBody>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Feedback category">
              {CATEGORIES.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  shape="round"
                  icon={option.icon}
                  aria-pressed={category === option.value}
                  disabled={submitting}
                  onClick={() => {
                    setCategory(option.value);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <label className="mt-4 flex flex-col gap-1.5">
              <span className="text-label text-secondary">Details</span>
              <textarea
                ref={descriptionRef}
                value={description}
                maxLength={2_000}
                disabled={submitting}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (error) setError('');
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder="What happened? What did you expect instead?"
                className="h-40 w-full resize-none rounded-md bg-field px-3 py-2 text-body-lg text-primary transition-colors duration-150 ease-out placeholder:text-muted enabled:hover:bg-active disabled:opacity-40"
              />
            </label>
            <div className="mt-1.5 flex items-start justify-between gap-4">
              <p className="text-caption text-muted">
                Includes a random pseudonymous ID (report-scoped while automatic diagnostics are
                off), app version, macOS version, architecture, and runtime versions. Chats, files,
                browser content, keys, and credentials are not attached unless you opt in to a
                screenshot below.
              </p>
              <span className="shrink-0 text-caption tabular-nums text-muted">
                {description.length}/2000
              </span>
            </div>
            {errorNote}

            <div className="mt-6">
              <div className="mb-2 text-label text-secondary">Include with this report</div>
              <div className="flex flex-wrap gap-4">
                {ATTACHMENTS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5 text-body text-secondary">
                    <input
                      type="checkbox"
                      checked={attachments[key]}
                      disabled={submitting}
                      onChange={(event) => {
                        setAttachments((prev) => ({ ...prev, [key]: event.target.checked }));
                        if (error) setError('');
                      }}
                      className="accent-accent"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-caption text-muted">
                Optional. Session log and app state contain anonymized operational facts only. The
                screenshot captures the full app window, which may include chats, file paths, and
                browser content. Uncheck all to exclude these optional attachments.
              </p>
            </div>
          </DialogBody>

          <DialogActions>
            <span className="mr-auto text-caption text-muted">⌘↵ to submit</span>
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={description.trim().length < 5 || submitting}
              aria-live="polite"
            >
              {submitting ? 'Sending…' : 'Submit report'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
