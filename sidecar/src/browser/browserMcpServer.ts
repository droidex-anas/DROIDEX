import { createSdkMcpServer, tool } from '@factory/droid-sdk';
import { z } from 'zod';
import type { BrowserOutcome, BrowserSessionManager } from './BrowserSessionManager.js';
import type { BrowserState, DesignReference } from './types.js';
import { jsonResult, safeTool } from '../mcpToolUtils.js';

const viewportSchema = z.object({
  width: z.number().int().min(240).max(4096),
  height: z.number().int().min(240).max(4096),
  deviceScaleFactor: z.number().positive().max(4).optional(),
});

const viewportModeSchema = z.enum(['fit', 'desktop', 'laptop', 'tablet', 'mobile', 'custom']);
const scrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);
const CLICK_VERBS: Record<number, string> = {
  1: 'Clicked',
  2: 'Double-clicked',
  3: 'Triple-clicked',
};

export function createBrowserMcpServer(
  manager: BrowserSessionManager,
  appSessionIdForTool: () => string | undefined,
) {
  const appSessionId = () => {
    const id = appSessionIdForTool();
    if (!id) throw new Error('Browser tools are not attached to a live DROIDEX session yet.');
    return id;
  };

  return createSdkMcpServer({
    name: 'droidex-browser',
    version: '0.1.0',
    tools: [
      tool(
        'browser_open',
        [
          'Open a URL in the live DROIDEX browser for this chat, the one the user can see, or go back, forward or reload.',
          'When the user asks to open a site, navigate, click or inspect, start here; a bare domain loads as https.',
          'Do not ask the user for a URL they already named.',
          'Do not use Read, FetchUrl, curl, or agent-browser as a substitute for browser work.',
          'Then call browser_read_page to see the page and get refs.',
        ].join(' '),
        {
          url: z
            .string()
            .min(1)
            .optional()
            .describe('URL to open, such as https://example.com or http://127.0.0.1:1421/.'),
          action: z
            .enum(['back', 'forward', 'reload'])
            .optional()
            .describe('Go back, forward or reload instead of opening a URL.'),
          viewport: viewportSchema.optional().describe('Optional explicit browser viewport.'),
          viewportMode: viewportModeSchema.optional().describe('Viewport preset label for the UI.'),
        },
        safeTool(async (input) => {
          const id = appSessionId();
          if (input.action === 'back') return said('Went back.', await manager.goBack(id));
          if (input.action === 'forward') return said('Went forward.', await manager.goForward(id));
          if (input.action === 'reload')
            return said('Reloaded the page.', await manager.reload(id));
          if (!input.url) throw new Error('Pass a url, or an action: back, forward or reload.');
          const outcome = await manager.open({
            appSessionId: id,
            url: input.url,
            viewport: input.viewport
              ? { ...input.viewport, deviceScaleFactor: input.viewport.deviceScaleFactor ?? 2 }
              : undefined,
            viewportMode: input.viewportMode ?? (input.viewport ? 'custom' : undefined),
          });
          return said('Opened the page.', outcome);
        }),
      ),
      tool(
        'browser_read_page',
        [
          'Read the page as a compact accessibility tree, one element per line, such as - button "Sign in" [ref=e3].',
          'Use the refs with browser_click, browser_hover, browser_fill, browser_type, browser_scroll and browser_inspect.',
          'A ref stays valid while its element is on the page; after a navigation, read the page again.',
          'Ends with [Title · url]. Sensitive field values are masked.',
        ].join(' '),
        {
          ref: z.string().optional().describe('Read only this element and what is inside it.'),
          filter: z
            .enum(['interactive', 'all'])
            .optional()
            .describe(
              'interactive lists only controls; all (default) includes text and structure.',
            ),
          max_chars: z
            .number()
            .int()
            .min(500)
            .max(100_000)
            .optional()
            .describe('Longest answer to return. Defaults to 12000 characters.'),
        },
        safeTool(async (input) =>
          manager.readPage(appSessionId(), {
            ref: input.ref,
            filter: input.filter,
            maxChars: input.max_chars,
          }),
        ),
      ),
      tool(
        'browser_read_text',
        [
          'Read the main content of the page as light markdown: headings, paragraphs, lists, table rows and links.',
          'Cheaper than browser_read_page for reading; it has no refs, so use browser_read_page to act.',
          'Field values are left out. Ends with [Title · url].',
        ].join(' '),
        {
          max_chars: z
            .number()
            .int()
            .min(500)
            .max(100_000)
            .optional()
            .describe('Longest answer to return. Defaults to 12000 characters.'),
        },
        safeTool(async (input) => manager.readText(appSessionId(), input.max_chars)),
      ),
      tool(
        'browser_find',
        'Find lines of the page tree that contain some text (or match a /regex/), each with the elements around it, up to 20.',
        {
          query: z.string().min(1).describe('Text to look for, or a /regex/ with optional flags.'),
        },
        safeTool(async (input) => manager.find(appSessionId(), input.query)),
      ),
      tool(
        'browser_screenshot',
        [
          'Capture the live DROIDEX browser as a JPEG (a PNG with format: "png"): the viewport, one ref, a region, or the full page.',
          'One image pixel is one CSS pixel unless the long edge would pass 1568; the result states the scale and origin so image points convert exactly.',
          'Sensitive fields are masked. Use browser_read_page to read the page and get refs.',
        ].join(' '),
        {
          ref: z.string().optional().describe('Crop to this element from browser_read_page.'),
          region: z
            .object({
              x: z.number(),
              y: z.number(),
              width: z.number().positive(),
              height: z.number().positive(),
            })
            .optional()
            .describe('Crop to this region of the viewport, in CSS pixels.'),
          full_page: z
            .boolean()
            .optional()
            .describe('Capture the whole page instead of the viewport.'),
          format: z
            .enum(['jpeg', 'png'])
            .optional()
            .describe('png only for pixel-exact design checks; jpeg (default) is far smaller.'),
        },
        safeTool(async (input) => {
          if ([input.ref, input.region, input.full_page].filter(Boolean).length > 1)
            throw new Error('Pass at most one of ref, region and full_page.');
          const shot = await manager.screenshot(appSessionId(), {
            ref: input.ref,
            region: input.region,
            fullPage: input.full_page,
            format: input.format,
          });
          return {
            content: [
              { type: 'text', text: `${shot.text}\nSaved at ${shot.path}` },
              { type: 'image', data: shot.image, mimeType: shot.mimeType },
            ],
          };
        }),
      ),
      tool(
        'browser_click',
        [
          'Click in the live DROIDEX browser by ref (preferred) or viewport x and y.',
          'A click by ref is refused, naming the element in the way, when something covers it.',
        ].join(' '),
        {
          ref: z.string().optional().describe('Element ref from browser_read_page.'),
          x: z.number().optional().describe('Viewport x, when there is no ref.'),
          y: z.number().optional().describe('Viewport y, when there is no ref.'),
          button: z.enum(['left', 'right', 'middle']).optional().describe('Defaults to left.'),
          count: z.number().int().min(1).max(3).optional().describe('2 for a double click.'),
          modifiers: z
            .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
            .optional()
            .describe('Keys held during the click.'),
        },
        safeTool(async (input) => {
          const outcome = await manager.click({ appSessionId: appSessionId(), ...input });
          const verb = input.button === 'right' ? 'Right-clicked' : CLICK_VERBS[input.count ?? 1];
          return said(`${verb} ${pointed(input)}.`, outcome);
        }),
      ),
      tool(
        'browser_hover',
        'Move the pointer over an element by ref or viewport x and y, to open menus or tooltips.',
        {
          ref: z.string().optional().describe('Element ref from browser_read_page.'),
          x: z.number().optional().describe('Viewport x, when there is no ref.'),
          y: z.number().optional().describe('Viewport y, when there is no ref.'),
        },
        safeTool(async (input) =>
          said(
            `Hovered ${pointed(input)}.`,
            await manager.hover({ appSessionId: appSessionId(), ...input }),
          ),
        ),
      ),
      tool(
        'browser_fill',
        [
          'Set a field by ref in one step: text, a select option (its value or visible label), a checkbox or radio (true or false), or a date (YYYY-MM-DD).',
          'Frameworks see the change as typed input. For real keystrokes use browser_type.',
        ].join(' '),
        {
          ref: z.string().describe('Field ref from browser_read_page.'),
          value: z.string().describe('The value, option, true or false, or date.'),
        },
        safeTool(async (input) =>
          said(`Filled ${input.ref}.`, await manager.fill(appSessionId(), input.ref, input.value)),
        ),
      ),
      tool(
        'browser_type',
        'Type real keystrokes into a field by ref, or into whatever has focus, and optionally press Enter after.',
        {
          text: z.string().describe('The text to type.'),
          ref: z.string().optional().describe('Field ref to focus first.'),
          submit: z.boolean().optional().describe('Press Enter after typing.'),
        },
        safeTool(async (input) => {
          const outcome = await manager.type(appSessionId(), input.text, {
            ref: input.ref,
            submit: input.submit,
          });
          const into = input.ref ? ` into ${input.ref}` : '';
          return said(
            `Typed ${String(input.text.length)} characters${into}${input.submit ? ' and pressed Enter' : ''}.`,
            outcome,
          );
        }),
      ),
      tool(
        'browser_press',
        'Press a key or chord on whatever has focus, such as Enter, Escape, Tab, ArrowDown, Shift+Tab or Meta+a.',
        {
          key: z
            .string()
            .min(1)
            .describe('A key name or one character, with + between keys held together.'),
          repeat: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe('How many times to press it.'),
        },
        safeTool(async (input) => {
          const outcome = await manager.press(appSessionId(), input.key, input.repeat);
          const times = input.repeat && input.repeat > 1 ? ` ${String(input.repeat)} times` : '';
          return said(`Pressed ${input.key}${times}.`, outcome);
        }),
      ),
      tool(
        'browser_resize',
        'Resize the viewport of the live DROIDEX browser. Use this to check responsive layouts or to match a specific screen size.',
        {
          viewport: viewportSchema.describe('New viewport dimensions.'),
          viewportMode: viewportModeSchema.optional().describe('Viewport preset label.'),
        },
        safeTool(async (input) => {
          const state = await manager.resizeViewport({
            appSessionId: appSessionId(),
            viewport: {
              ...input.viewport,
              deviceScaleFactor: input.viewport.deviceScaleFactor ?? 2,
            },
            viewportMode: input.viewportMode ?? 'custom',
          });
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_scroll',
        'Scroll the page, or inside the element a ref names; a ref with no direction is only brought into view. Then read the page again to see what came into view.',
        {
          direction: scrollDirectionSchema.optional().describe('Direction to scroll.'),
          pixels: z.number().positive().max(4000).optional().describe('Defaults to 500.'),
          ref: z.string().optional().describe('Element to scroll in, or to bring into view.'),
        },
        safeTool(async (input) => {
          const outcome = await manager.scroll(appSessionId(), input);
          const where = input.ref ? ` in ${input.ref}` : '';
          return said(
            input.direction
              ? `Scrolled ${input.direction}${where}.`
              : `Brought ${input.ref ?? 'it'} into view.`,
            outcome,
          );
        }),
      ),
      tool(
        'browser_wait',
        'Wait for browser text, a ref, or a URL fragment before continuing. With no condition, waits for the requested duration.',
        {
          text: z
            .string()
            .optional()
            .describe('Text to wait for on the page, matched like browser_find.'),
          ref: z.string().optional().describe('Element ref that must be on the current page.'),
          urlIncludes: z.string().optional().describe('URL fragment to wait for.'),
          timeoutMs: z
            .number()
            .int()
            .min(0)
            .max(15_000)
            .optional()
            .describe('Maximum wait in milliseconds. Defaults to 5000.'),
        },
        safeTool(async (input) => {
          const state = await manager.wait(appSessionId(), input);
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_inspect',
        [
          'Inspect one element without enabling Design Mode or taking another full-page snapshot.',
          'Returns bounded HTML, sanitized attributes, geometry, and iframe source/accessibility metadata.',
          'Use a ref from browser_read_page when possible, or provide a CSS selector.',
          'Credential values, auth tokens, and sensitive URL parameters are redacted.',
        ].join(' '),
        {
          ref: z.string().optional().describe('Element ref from browser_read_page.'),
          selector: z.string().optional().describe('CSS selector when no ref is available.'),
        },
        safeTool(async (input) => {
          const inspection = await manager.inspect(appSessionId(), input);
          return jsonResult({ ok: true, inspection });
        }),
      ),
      tool(
        'browser_network',
        [
          'Read the latest bounded network diagnostics for this browser session.',
          'Returns at most 100 completed or failed requests with method, URL, resource type, status, and error.',
          'Headers and response bodies are never captured; credentials and sensitive URL parameters are redacted.',
        ].join(' '),
        {
          clear: z
            .boolean()
            .optional()
            .describe('Return the current events and clear the retained buffer afterward.'),
        },
        safeTool(async (input) => {
          const events = await manager.network(appSessionId(), input.clear ?? false);
          return jsonResult({ ok: true, events });
        }),
      ),
      tool(
        'browser_console',
        [
          'Read the latest bounded JavaScript console diagnostics for this browser session.',
          'Returns at most 100 entries with level, message, line, and source.',
          'Messages and source URLs are length-limited and credential-like values are redacted.',
        ].join(' '),
        {
          clear: z
            .boolean()
            .optional()
            .describe('Return the current entries and clear the retained buffer afterward.'),
        },
        safeTool(async (input) => {
          const events = await manager.console(appSessionId(), input.clear ?? false);
          return jsonResult({ ok: true, events });
        }),
      ),
      tool(
        'browser_fill_login',
        [
          'Fill the saved login for the current site in the live DROIDEX browser.',
          'You never see the username or password: the app writes them into the form, and every read masks them. This lets you authorize a sign-in without reading the secret.',
          'Saved logins are strictly opt-in. Use only when a sign-in form is visible and the user has enabled saved logins and saved one for this site.',
          'Returns an error if saved logins are off or none is saved; then ask the user to sign in once and accept the save-login prompt. After filling, submit with browser_click or browser_press.',
        ].join(' '),
        {},
        safeTool(async () =>
          said('Filled the saved login.', await manager.fillCredentials(appSessionId())),
        ),
      ),
      tool(
        'design-mode',
        [
          'Read the current Design Mode browser context for this chat only.',
          'Use after the user selects, clicks, or sketches an area in the live DROIDEX browser pane.',
          'Returns compact source-anchored references: each has an @id, label, kind, tag/role/name/text, box, resolved source (framework/component/file), a verified CSS selector, and a cropped screenshotPath.',
          'When you need the full element detail (all attributes, computed styles, ancestor chain, outerHTML), call design_reference with the @id instead of asking the user.',
          'Design Mode is for visual/UI work only: change the referenced elements and their styling, and do not modify backend, data, or business logic. If achieving the requested look requires a backend or data change, stop and tell the user what is needed and why instead of changing it yourself or spawning subagents.',
        ].join(' '),
        {
          instruction: z
            .string()
            .optional()
            .describe('Optional user design instruction to keep alongside the returned context.'),
        },
        safeTool(async (input) => {
          const context = manager.designContext(appSessionId());
          const refs = context.references;
          const images = refs
            .filter((r) => r.screenshot)
            .map((r) => ({
              type: 'image' as const,
              data: r.screenshot!.base64,
              mimeType: 'image/png' as const,
            }));
          const result = jsonResult({
            ok: true,
            instruction: input.instruction,
            ...stateForTool(context.state, refs),
          });
          if (images.length > 0) {
            return { content: [{ type: 'text' as const, text: result }, ...images] };
          }
          return result;
        }),
      ),
      tool(
        'design_reference',
        [
          'Fetch the full source-anchored detail for one Design Mode reference by its @id.',
          'Use the @id values returned by design-mode to inspect the exact verified selector, attributes, computed styles, ancestor chain, resolved source component/file, and the cropped screenshot path before editing code.',
        ].join(' '),
        {
          id: z
            .string()
            .min(1)
            .describe(
              'Design reference id returned by design-mode, e.g. @live-ab12cd or @region-...',
            ),
        },
        safeTool(async (input) => {
          const ref = manager.referenceDetail(appSessionId(), input.id);
          if (!ref) {
            return jsonResult({
              ok: false,
              error: `No design reference ${input.id}. Call design-mode to list the current references.`,
            });
          }
          const text = jsonResult({ ok: true, reference: designReferenceDetail(ref) });
          if (ref.screenshot?.base64) {
            return {
              content: [
                { type: 'text' as const, text },
                {
                  type: 'image' as const,
                  data: ref.screenshot.base64,
                  mimeType: 'image/png' as const,
                },
              ],
            };
          }
          return text;
        }),
      ),
    ],
  });
}

// One line of what the action did, then what changed and the page footer.
function said(done: string, outcome: BrowserOutcome): string {
  return `${done}\n${outcome.text}`;
}

function pointed(input: { ref?: string; x?: number; y?: number }): string {
  return input.ref ?? `(${String(input.x)}, ${String(input.y)})`;
}

function stateForTool(
  state: BrowserState,
  designReferences: DesignReference[] = [],
): Record<string, unknown> {
  return {
    ok: true,
    url: state.url,
    title: state.title,
    viewport: state.viewport,
    viewportMode: state.viewportMode,
    scroll: state.scroll,
    canGoBack: state.canGoBack ?? false,
    canGoForward: state.canGoForward ?? false,
    designReferences: designReferences.map(designReferenceSummary),
  };
}

function designReferenceSummary(ref: DesignReference): Record<string, unknown> {
  const anchor = ref.anchor;
  const out: Record<string, unknown> = {
    id: ref.id,
    kind: anchor.kind,
    label: anchor.label,
    tag: anchor.tag,
    role: anchor.role,
    name: anchor.name,
    text: anchor.text,
    box: anchor.box,
    source: anchor.source,
    selector: ref.detail?.selector,
    selectorVerified: ref.detail?.selectorVerified,
    screenshotPath: anchor.screenshotPath,
    url: ref.url,
  };
  if (anchor.strokes) out.strokes = anchor.strokes;
  // The annotated screenshot bytes are returned as a separate image block by
  // the design-mode / design_reference tools; keep them out of the JSON to
  // avoid duplicating large base64 payloads.
  if (ref.screenshot) out.hasScreenshot = true;
  return out;
}

function designReferenceDetail(ref: DesignReference): Record<string, unknown> {
  return {
    ...designReferenceSummary(ref),
    title: ref.title,
    viewport: ref.viewport,
    scroll: ref.scroll,
    createdAt: ref.createdAt,
    detail: ref.detail
      ? {
          selector: ref.detail.selector,
          selectorVerified: ref.detail.selectorVerified,
          attributes: ref.detail.attributes,
          styles: ref.detail.styles,
          ancestors: ref.detail.ancestors,
          html: ref.detail.html,
        }
      : undefined,
  };
}
