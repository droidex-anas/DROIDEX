import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { shallowEqual, useStoreDispatch, useStoreSelector, type AppState } from '../hooks/useStore';
import { respondPermission } from '../lib/commands';
import type { PermissionKind, PermissionOutcome } from '../types/bridge';
import { PROVIDER_LABELS } from '../features/providers/providerIdentity';
import { extractFileChange } from '../lib/diff';
import { inlineCardMotion } from './inlineCardMotion';
import { DiffPreview } from './DiffView';
import { Button } from './ui/Button';

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
      <span className="break-words whitespace-pre-wrap text-primary">{headline || detail}</span>
    );
  }
  const slash = headline.lastIndexOf('/');
  if (slash <= 0) return <span className="break-all text-primary">{headline}</span>;
  return (
    <span className="break-all">
      <span className="text-muted/60">{headline.slice(0, slash + 1)}</span>
      <span className="text-primary">{headline.slice(slash + 1)}</span>
    </span>
  );
}

export default function PermissionInline({ appSessionId }: { appSessionId: string }) {
  const dispatch = useStoreDispatch();
  const reduceMotion = useReducedMotion();
  // Permission requests are session-scoped, and a session can be waiting on
  // more than one: the oldest is the one the user is asked about.
  const state = useStoreSelector((current) => {
    const sessions: Partial<AppState['sessions']> = current.sessions;
    return {
      request: current.pendingPermissions[appSessionId]?.[0],
      provider: sessions[appSessionId]?.provider,
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
        className="mb-2.5 overflow-hidden rounded-xl bg-raised shadow-lg"
      >
        <div className="flex items-start gap-2 px-4 pt-3.5 pb-3">
          {/* Permission asks are an attention signal: a warning dot marks the ask. */}
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-body-strong">
              {detail ? <Subject kind={req.kind} detail={detail} /> : reason}
            </div>
            {detail && <div className="mt-0.5 text-body break-words text-muted">{explanation}</div>}
          </div>
        </div>

        {fullDetail && (
          <div className="px-4 pb-3">
            <div className="max-h-32 overflow-y-auto rounded-lg bg-bg/50 px-3.5 py-2.5 text-body">
              <span className="whitespace-pre-wrap break-words text-primary">{fullDetail}</span>
            </div>
          </div>
        )}

        {change && (
          <div className="px-4 pb-3">
            {/* Every line, in the same box: allowing it agrees to all of it. */}
            <DiffPreview ops={change.ops} complete />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3.5">
          <Button
            variant="ghost"
            onClick={() => {
              respond('refuse');
            }}
          >
            Deny
          </Button>
          {/* Only offered when the harness will let a grant be remembered. */}
          {req.canAlwaysAllow && (
            <Button
              onClick={() => {
                respond('proceed_always');
              }}
            >
              Always allow
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              respond('proceed_once');
            }}
          >
            Allow once
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
