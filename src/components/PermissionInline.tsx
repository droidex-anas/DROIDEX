import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { respondPermission } from '../lib/commands';
import type { PermissionKind, PermissionOutcome, PermissionRequest } from '../types/bridge';
import { PROVIDER_LABELS } from '../features/providers/providerIdentity';
import { extractFileChange } from '../lib/diff';
import { inlineCardMotion } from './inlineCardMotion';
import { DiffPreview } from './DiffView';

const ACCENT = 'var(--droid-accent)';
// Permission asks are an attention signal: a small warning dot marks the ask
// while the card itself stays on the standard elevated surface.
const WARN = 'var(--droid-orange)';

// A plain-language explanation of what the agent is asking to do, so the
// prompt is never just a bare "Permission required". The subject is the chat's
// own provider: only it is actually asking.
const KIND_PROMPT: Record<PermissionKind, string> = {
  exec: 'wants to run a terminal command',
  edit: 'wants to edit a file',
  create: 'wants to create a file',
  apply_patch: 'wants to apply a code patch',
  mcp: 'wants to use an external tool',
  spec: 'wants to finish planning',
  mission_plan: 'proposed a mission plan',
  other: 'is requesting permission to proceed',
};

// Backend titles that only restate the kind add nothing to the explanation;
// meaningful ones (e.g. MCP "server · tool") are worth naming.
const GENERIC_TITLES = new Set([
  'Permission required',
  'Run command',
  'Edit file',
  'Create file',
  'Apply patch',
]);

const FILE_KINDS = new Set<PermissionKind>(['edit', 'create', 'apply_patch']);

function cleanDetail(detail: string | undefined): string {
  const t = (detail ?? '').trim();
  if (!t || t === '{}' || t === '[]' || t === 'null' || t === 'undefined') return '';
  return t;
}

/** The concrete thing being asked about, headlined: a path keeps its
    directory quiet so the file's own name carries the line. */
function Subject({ kind, detail }: { kind: PermissionKind; detail: string }) {
  const headline = detail.split('\n')[0];
  if (!FILE_KINDS.has(kind) || headline.includes(' ')) {
    return (
      <span className="break-words whitespace-pre-wrap text-droid-text">{headline || detail}</span>
    );
  }
  const slash = headline.lastIndexOf('/');
  if (slash <= 0) return <span className="break-all text-droid-text">{headline}</span>;
  return (
    <span className="break-all">
      <span className="text-droid-text-muted/60">{headline.slice(0, slash + 1)}</span>
      <span className="text-droid-text">{headline.slice(slash + 1)}</span>
    </span>
  );
}

export default function PermissionInline() {
  const dispatch = useStoreDispatch();
  const reduceMotion = useReducedMotion();
  // Permission requests are session-scoped, and a session can be waiting on
  // more than one: the oldest is the one the user is asked about.
  const state = useStoreSelector((current) => {
    const active = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : undefined;
    return {
      request: current.activeAppSessionId
        ? current.pendingPermissions[current.activeAppSessionId]?.[0]
        : undefined,
      provider: active?.provider,
    };
  }, shallowEqual);
  const req = state.request;

  // Spec/mission plans use the dedicated approval bar (<PlanApprovalInline />).
  if (!req || req.kind === 'spec' || req.kind === 'mission_plan') return null;

  const detail = cleanDetail(req.detail);
  const title = req.title && !GENERIC_TITLES.has(req.title) ? req.title : '';
  const reason = `${PROVIDER_LABELS[state.provider ?? 'droid']} ${KIND_PROMPT[req.kind]}`;
  const explanation = title ? `${reason} · ${title}` : reason;
  // Whatever is asked about has to be readable in full before it is allowed:
  // a command past its first line, every file of a change, every input of a
  // tool call.
  const fullDetail = detail.includes('\n') ? detail : '';
  const change = req.diff ? extractFileChange('apply_patch', req.diff) : null;

  const respond = (outcome: PermissionOutcome) => {
    respondPermission(req.appSessionId, req.requestId, outcome);
    dispatch({
      type: 'CLEAR_PERMISSION',
      appSessionId: req.appSessionId,
      requestId: req.requestId,
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        key={req.requestId}
        {...inlineCardMotion(reduceMotion)}
        className="mb-2.5 overflow-hidden rounded-2xl border border-droid-border bg-droid-raised shadow-droid"
      >
        <div className="flex items-start gap-2 px-4 pt-3.5 pb-3">
          <span
            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: WARN }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-snug">
              {detail ? <Subject kind={req.kind} detail={detail} /> : reason}
            </div>
            {detail && (
              <div className="mt-0.5 text-[12px] leading-snug break-words text-droid-text-muted">
                {explanation}
              </div>
            )}
          </div>
        </div>

        {fullDetail && (
          <div className="px-4 pb-3">
            <div className="max-h-32 overflow-y-auto rounded-xl border border-droid-border/70 bg-droid-bg/50 px-3.5 py-2.5 text-[13px] leading-relaxed">
              <span className="whitespace-pre-wrap break-words text-droid-text">{fullDetail}</span>
            </div>
          </div>
        )}

        {change && (
          <div className="px-4 pb-3">
            {/* Every line, in the same box: allowing it agrees to all of it. */}
            <DiffPreview ops={change.ops} complete />
          </div>
        )}

        <Actions request={req} onRespond={respond} />
      </motion.div>
    </AnimatePresence>
  );
}

function Actions({
  request,
  onRespond,
}: {
  request: PermissionRequest;
  onRespond: (outcome: PermissionOutcome) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3.5">
      <button
        onClick={() => {
          onRespond('refuse');
        }}
        className="rounded-full px-3.5 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-surface hover:text-droid-text"
      >
        Deny
      </button>
      {/* Only offered when the harness will let a grant be remembered. */}
      {request.canAlwaysAllow && (
        <button
          onClick={() => {
            onRespond('proceed_always');
          }}
          className="rounded-full border border-droid-border bg-droid-bg/40 px-3.5 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:border-droid-border-hover hover:text-droid-text"
        >
          Always allow
        </button>
      )}
      <button
        onClick={() => {
          onRespond('proceed_once');
        }}
        className="rounded-full px-4 py-1.5 text-[12px] font-semibold text-droid-bg transition-opacity hover:opacity-90"
        style={{ background: ACCENT }}
      >
        Allow once
      </button>
    </div>
  );
}
