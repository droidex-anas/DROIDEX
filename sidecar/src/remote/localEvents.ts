import { z } from 'zod';

const session = z.object({
  appSessionId: z.string(),
  title: z.string(),
  provider: z.enum(['droid', 'claude', 'codex']),
  autonomy: z.enum(['off', 'low', 'medium', 'high']),
  phase: z.string(),
  streaming: z.boolean().optional(),
});
const request = z.object({
  appSessionId: z.string(),
  requestId: z.string(),
  title: z.string(),
  detail: z.string(),
});
const transcript = z.object({
  appSessionId: z.string(),
  kind: z.string(),
  text: z.string().optional(),
  id: z.string(),
  author: z.literal('user').optional(),
  role: z.string().optional(),
  childSessionId: z.string().optional(),
});
export type LocalTranscript = z.infer<typeof transcript>;
export type LocalSession = z.infer<typeof session>;
export type LocalApproval = z.infer<typeof request>;

export const localEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.created'), session }),
  z.object({ type: z.literal('session.updated'), session }),
  z.object({ type: z.literal('session.closed'), appSessionId: z.string() }),
  z.object({
    type: z.literal('remote.snapshot'),
    sessions: z.array(session),
    approvals: z.array(request),
  }),
  z.object({ type: z.literal('sessions.list'), sessions: z.array(session) }),
  z.object({ type: z.literal('approval.requested'), request }),
  z.object({ type: z.literal('interaction.cancelled'), requestId: z.string() }),
  z.object({ type: z.literal('event.appended'), event: transcript }),
  z.object({
    type: z.literal('session.history'),
    appSessionId: z.string(),
    transcripts: z.array(transcript),
    childSessionId: z.string().optional(),
  }),
]);

export type LocalEvent = z.infer<typeof localEvent>;
