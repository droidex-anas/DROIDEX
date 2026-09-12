import { z } from 'zod';

export const automationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('new-session') }),
  z.object({ kind: z.literal('existing-session'), appSessionId: z.string().trim().min(1) }),
]);
export const automationFilesSchema = z.array(z.string().min(1).max(4096)).max(16);
export const automationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), runAt: z.number().finite() }),
  z.object({ kind: z.literal('hourly'), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal('daily'), time: z.string() }),
  z.object({ kind: z.literal('weekdays'), time: z.string() }),
  z.object({
    kind: z.literal('weekly'),
    weekday: z.number().int().min(0).max(6),
    time: z.string(),
  }),
  z.object({ kind: z.literal('cron'), expression: z.string() }),
]);
const inputSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  target: automationTargetSchema.optional(),
  files: automationFilesSchema.optional(),
  workspaceCwd: z.string().nullable().optional(),
  executionMode: z.enum(['local', 'worktree']).optional(),
  enabled: z.boolean().optional(),
  schedule: automationScheduleSchema,
  timezone: z.string().optional(),
  modelId: z.string().nullable().optional(),
  reasoningEffort: z
    .enum(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'dynamic'])
    .nullable()
    .optional(),
  autonomy: z.enum(['off', 'low', 'medium', 'high']).optional(),
});
export const automationCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('automations.list'), requestId: z.string() }),
  z.object({ type: z.literal('automations.create'), requestId: z.string(), input: inputSchema }),
  z.object({
    type: z.literal('automations.update'),
    requestId: z.string(),
    id: z.string(),
    patch: inputSchema.partial(),
  }),
  z.object({ type: z.literal('automations.delete'), requestId: z.string(), id: z.string() }),
  z.object({
    type: z.literal('automations.setEnabled'),
    requestId: z.string(),
    id: z.string(),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal('automations.runNow'), requestId: z.string(), id: z.string() }),
  z.object({
    type: z.literal('automations.confirmProposal'),
    requestId: z.string(),
    id: z.string(),
    input: inputSchema.optional(),
  }),
]);
