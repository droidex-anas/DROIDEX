import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { FeedbackReportRequest } from '../../lib/desktop';
import { openExternal } from '../../lib/onboarding';

const LazyFeedbackModal = lazy(async () => {
  const module = await import('../../components/FeedbackModal');
  return { default: module.FeedbackModal };
});

const X_PROFILE_URL = 'https://x.com/anasibnanwar';

/* Projects is in beta. The line says so and gives three ways to be heard: the
   app's own private report, as feedback or as a bug (the same dialog /feedback
   and /bug open from the composer), and the maker's account on X. */
export function ProjectsBetaNote({ className = '' }: { className?: string }) {
  const [report, setReport] = useState<FeedbackReportRequest | null>(null);
  return (
    <>
      <p className={className}>
        Projects is in beta. Share bugs and ideas with{' '}
        <NoteLink
          onClick={() => {
            setReport({ category: 'other', description: '' });
          }}
        >
          /feedback
        </NoteLink>{' '}
        or{' '}
        <NoteLink
          onClick={() => {
            setReport({ category: 'bug', description: '' });
          }}
        >
          /bug
        </NoteLink>
        , or at{' '}
        <NoteLink
          onClick={() => {
            void openExternal(X_PROFILE_URL);
          }}
        >
          @anasibnanwar
        </NoteLink>{' '}
        on X.
      </p>
      {report && (
        <Suspense fallback={null}>
          <LazyFeedbackModal
            initialReport={report}
            onClose={() => {
              setReport(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}

function NoteLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-droid-text-secondary underline-offset-2 transition-colors hover:text-droid-text hover:underline"
    >
      {children}
    </button>
  );
}
