import { tool } from '@factory/droid-sdk';
import { z } from 'zod';
import { altDroidHome } from '../droidProfiles.js';
import { autonomySchema, jsonResult, reasoningSchema, safeTool } from '../mcpToolUtils.js';
import { PROVIDER_KINDS } from '../providers/providerKind.js';
import { requireProjectService } from './service.js';
import { LEDGER_LIMITS } from './store.js';

const spawnInput = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(LEDGER_LIMITS.title)
    .describe("Short task name in the user's words."),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(LEDGER_LIMITS.text)
    .describe('The whole task, with everything it needs to start.'),
  reportBack: z
    .boolean()
    .describe(
      'true: reports to this chat. false: a sidebar chat with no reports. Threads must use true.',
    ),
  provider: z.enum(PROVIDER_KINDS).optional().describe("Harness. Omit for this chat's."),
  profile: z
    .enum(['main', 'alt'])
    .optional()
    .describe(
      'Local Factory login for this Droid thread. Omit to inherit. Alt uses the isolated second subscription.',
    ),
  modelId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Model id or display name. Omit to inherit this chat's model. Unknown models are refused.",
    ),
  reasoningEffort: reasoningSchema.optional(),
  autonomy: autonomySchema.optional().describe("At most this chat's. Omit to inherit it."),
  workspace: z
    .enum(['inherit', 'worktree'])
    .optional()
    .describe(
      "worktree: its own checkout on a new branch. inherit: this chat's folder. Omitted: a thread gets its own worktree when another thread is working in the folder; a chat shares the folder.",
    ),
  workspaceOf: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Threads only. Id of a settled thread of this chat whose checkout it joins, to review that work.',
    ),
  branch: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('Worktree branch. Named after the task when omitted, prefixed thread/.'),
  base: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Commit, branch or tag the worktree starts from. HEAD when omitted.'),
  step: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Threads only. The plan step it carries, by number or exact title.'),
});

export function threadSpawnTool(appSessionId: () => string) {
  const enabled = altDroidHome() !== undefined;
  // A disabled Alt choice must be rejected, not discarded by MCP validation.
  return tool(
    'thread_spawn',
    'Create a separate chat for a decided task; include all task context in prompt. reportBack true creates a thread that reports here; false creates a sidebar chat read with session_read. Settings inherit unless specified. Threads queue at full capacity and return a position; held projects refuse. A matching title returns a reuse hint but still creates the thread.',
    {
      ...spawnInput.shape,
      profile: enabled
        ? spawnInput.shape.profile
        : z.literal('main').optional().describe('Droid login profile. Omit for the current login.'),
      modelId: enabled
        ? spawnInput.shape.modelId.describe(
            'Model id or display name for Main. Alt requires an exact model id available to its own Factory account; omit to inherit the owner model id.',
          )
        : spawnInput.shape.modelId,
    },
    safeTool(async ({ reportBack, ...input }: z.infer<typeof spawnInput>) => {
      const projects = await requireProjectService();
      if (!reportBack) {
        const chat = await projects.startChat(appSessionId(), input);
        return jsonResult({
          ok: true,
          reportBack: false,
          sessionId: chat.appSessionId,
          title: chat.title,
          ...(chat.droidProfile ? { droidProfile: chat.droidProfile } : {}),
          ...(chat.cwd ? { cwd: chat.cwd } : {}),
          ...(chat.branch ? { branch: chat.branch } : {}),
          note: 'Started a sidebar chat. It will not report here; read it with session_read.',
        });
      }
      const started = await projects.spawn(appSessionId(), input);
      return jsonResult({
        ok: true,
        reportBack: true,
        threadId: started.appSessionId,
        title: started.title,
        state: started.state,
        ...(projects.read(appSessionId(), started.appSessionId).droidProfile
          ? { droidProfile: 'alt' }
          : {}),
        delivery: started.delivery,
        runtimeLoad: started.runtimeLoad,
        ...(started.position ? { position: started.position } : {}),
        ...(started.waitReason ? { waitReason: started.waitReason } : {}),
        ...(started.reuseNote ? { reuseNote: started.reuseNote } : {}),
        ...(started.cwd ? { cwd: started.cwd } : {}),
        ...(started.branch ? { branch: started.branch } : {}),
        ...(started.step ? { step: started.step } : {}),
        note:
          started.delivery === 'queued'
            ? 'Queued to start. Reports will arrive here after it runs; do not respawn it.'
            : 'Started. Reports arrive here, including during your turn. End your turn when no work remains.',
      });
    }),
  );
}
