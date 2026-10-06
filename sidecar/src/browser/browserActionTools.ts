import { z } from 'zod';
import type { BrowserOutcome, BrowserSessionManager } from './BrowserSessionManager.js';

// The actions an agent takes on a page, shared by their own tools and
// browser_batch: their fields, and each one's answer as one line of what it
// did, then what changed and the page footer.

const scrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);
const CLICK_VERBS: Record<number, string> = {
  1: 'Clicked',
  2: 'Double-clicked',
  3: 'Triple-clicked',
};
export const MAX_BATCH_STEPS = 20;
const DEFAULT_WAIT_MS = 5_000;

// The fields of each action, shared by its own tool and browser_batch.
export const pointShape = {
  ref: z.string().optional().describe('Element ref from browser_read_page.'),
  x: z.number().optional().describe('Viewport x, when there is no ref.'),
  y: z.number().optional().describe('Viewport y, when there is no ref.'),
};
export const clickShape = {
  ...pointShape,
  button: z.enum(['left', 'right', 'middle']).optional().describe('Defaults to left.'),
  count: z.number().int().min(1).max(3).optional().describe('2 for a double click.'),
  modifiers: z
    .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
    .optional()
    .describe('Keys held during the click.'),
};
export const fillShape = {
  ref: z.string().describe('Field ref from browser_read_page.'),
  value: z.string().describe('The value, option, true or false, or date.'),
};
export const typeShape = {
  text: z.string().describe('The text to type.'),
  ref: z.string().optional().describe('Field ref to focus first.'),
  submit: z.boolean().optional().describe('Press Enter after typing.'),
};
export const pressShape = {
  key: z
    .string()
    .min(1)
    .describe('A key name or one character, with + between keys held together.'),
  repeat: z.number().int().min(1).max(50).optional().describe('How many times to press it.'),
};
export const scrollShape = {
  direction: scrollDirectionSchema.optional().describe('Direction to scroll.'),
  pixels: z.number().positive().max(4000).optional().describe('Defaults to 500.'),
  ref: z.string().optional().describe('Element to scroll in, or to bring into view.'),
};
export const waitShape = {
  text: z.string().optional().describe('Text that must be on the page, matched like browser_find.'),
  textGone: z.string().optional().describe('Text that must no longer be on the page.'),
  ref: z.string().optional().describe('Element ref that must be on the page.'),
  urlIncludes: z.string().optional().describe('Fragment the address must have.'),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(15_000)
    .optional()
    .describe('Longest wait in milliseconds. Defaults to 5000.'),
};
export const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), ...clickShape }),
  z.object({ action: z.literal('hover'), ...pointShape }),
  z.object({ action: z.literal('fill'), ...fillShape }),
  z.object({ action: z.literal('type'), ...typeShape }),
  z.object({ action: z.literal('press'), ...pressShape }),
  z.object({ action: z.literal('scroll'), ...scrollShape }),
  z.object({ action: z.literal('wait'), ...waitShape }),
]);

type Input<Shape extends z.ZodRawShape> = z.infer<z.ZodObject<Shape>>;

/** What an action did, in one line, and the page it left. */
interface Did {
  done: string;
  outcome: BrowserOutcome;
}

type Step = z.infer<typeof stepSchema>;

export function browserActs(manager: BrowserSessionManager) {
  const act = {
    click: async (id: string, input: Input<typeof clickShape>): Promise<Did> => {
      const outcome = await manager.click({ appSessionId: id, ...input });
      const count = input.count ?? 1;
      const other = input.button === 'right' || input.button === 'middle';
      const verb = other
        ? `${input.button === 'right' ? 'Right' : 'Middle'}-clicked`
        : CLICK_VERBS[count];
      const times = other && count > 1 ? ` ${String(count)} times` : '';
      return { done: `${verb} ${pointed(input)}${times}.`, outcome };
    },
    hover: async (id: string, input: Input<typeof pointShape>): Promise<Did> => ({
      done: `Hovered ${pointed(input)}.`,
      outcome: await manager.hover({ appSessionId: id, ...input }),
    }),
    fill: async (id: string, input: Input<typeof fillShape>): Promise<Did> => ({
      done: `Filled ${input.ref}.`,
      outcome: await manager.fill(id, input.ref, input.value),
    }),
    type: async (id: string, input: Input<typeof typeShape>): Promise<Did> => {
      const outcome = await manager.type(id, input.text, { ref: input.ref, submit: input.submit });
      const into = input.ref ? ` into ${input.ref}` : '';
      const enter = input.submit ? ' and pressed Enter' : '';
      return { done: `Typed ${String(input.text.length)} characters${into}${enter}.`, outcome };
    },
    press: async (id: string, input: Input<typeof pressShape>): Promise<Did> => {
      const outcome = await manager.press(id, input.key, input.repeat);
      const times = input.repeat && input.repeat > 1 ? ` ${String(input.repeat)} times` : '';
      return { done: `Pressed ${input.key}${times}.`, outcome };
    },
    scroll: async (id: string, input: Input<typeof scrollShape>): Promise<Did> => {
      const outcome = await manager.scroll(id, input);
      const where = input.ref ? ` in ${input.ref}` : '';
      const done = input.direction
        ? `Scrolled ${input.direction}${where}.`
        : `Brought ${input.ref ?? 'it'} into view.`;
      return { done, outcome };
    },
    wait: async (id: string, input: Input<typeof waitShape>): Promise<Did> => {
      const started = Date.now();
      const { text, textGone, ref, urlIncludes, timeoutMs = DEFAULT_WAIT_MS } = input;
      const outcome = await manager.wait(id, {
        text,
        textGone,
        ref,
        urlIncludes,
        waitMs: timeoutMs,
      });
      return { done: waited(input, Date.now() - started), outcome };
    },
  };

  function runStep(id: string, step: Step): Promise<Did> {
    switch (step.action) {
      case 'click':
        return act.click(id, step);
      case 'hover':
        return act.hover(id, step);
      case 'fill':
        return act.fill(id, step);
      case 'type':
        return act.type(id, step);
      case 'press':
        return act.press(id, step);
      case 'scroll':
        return act.scroll(id, step);
      case 'wait':
        return act.wait(id, step);
    }
  }

  // Steps in order, until one fails; one line each, then the footer of the
  // page the last one left.
  async function batch(id: string, steps: Step[]): Promise<string> {
    const lines: string[] = [];
    let footer = '';
    // Every step goes to the browser the batch started on.
    const browserSessionId = manager.state(id)?.browserSessionId;
    for (const [index, step] of steps.entries()) {
      try {
        if (manager.state(id)?.browserSessionId !== browserSessionId)
          throw new Error('The browser was closed during the batch.');
        const { done, outcome } = await runStep(id, step);
        // An outcome's last line is its [Title · url] footer.
        const notes = outcome.text.split('\n');
        footer = notes.pop() ?? '';
        lines.push(`${String(index + 1)}. ${[done, ...notes].join(' ')}`);
      } catch (error) {
        const skipped = steps.length - index - 1;
        lines.push(`${String(index + 1)}. Failed: ${errorText(error)}`);
        if (skipped) lines.push(`Stopped there; ${String(skipped)} more not run.`);
        break;
      }
    }
    return [...lines, footer].filter(Boolean).join('\n');
  }

  return { act, batch };
}

// One line of what the action did, then what changed and the page footer.
export function said({ done, outcome }: Did): string {
  return `${done}\n${outcome.text}`;
}

function waited(input: Input<typeof waitShape>, ms: number): string {
  const conditions = [
    input.text && `"${input.text}" is on the page`,
    input.textGone && `"${input.textGone}" is gone`,
    input.ref && `${input.ref} is on the page`,
    input.urlIncludes && `the address has "${input.urlIncludes}"`,
  ].filter(Boolean);
  const after = `${(ms / 1000).toFixed(1)} s`;
  return conditions.length ? `After ${after}, ${conditions.join(', ')}.` : `Waited ${after}.`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pointed(input: { ref?: string; x?: number; y?: number }): string {
  return input.ref ?? `(${String(input.x)}, ${String(input.y)})`;
}
