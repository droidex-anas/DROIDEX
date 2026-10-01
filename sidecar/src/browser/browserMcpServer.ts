import { createSdkMcpServer, tool } from '@factory/droid-sdk';
import { z } from 'zod';
import type { BrowserSessionManager } from './BrowserSessionManager.js';
import type { BrowserState, DesignReference } from './types.js';
import { jsonResult, safeTool } from '../mcpToolUtils.js';

const viewportSchema = z.object({
  width: z.number().int().min(240).max(4096),
  height: z.number().int().min(240).max(4096),
  deviceScaleFactor: z.number().positive().max(4).optional(),
});

const viewportModeSchema = z.enum(['fit', 'desktop', 'laptop', 'tablet', 'mobile', 'custom']);
const scrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);

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
          'Open and show a URL in the live DROIDEX browser pane for this chat session.',
          'This is the browser the user can see and control in DROIDEX.',
          'When the user asks to open a site, navigate, click, inspect, or control a browser, call this tool first with the site URL.',
          'If the user names a domain without a scheme, pass it directly; DROIDEX will load it as https.',
          'Do not ask the user for a URL when they already named a site or domain.',
          'Do not use Read, FetchUrl, curl, or agent-browser as a substitute for browser work.',
        ].join(' '),
        {
          url: z
            .string()
            .min(1)
            .describe(
              'Absolute URL to open, such as https://example.com or http://127.0.0.1:1421/.',
            ),
          viewport: viewportSchema.optional().describe('Optional explicit browser viewport.'),
          viewportMode: viewportModeSchema.optional().describe('Viewport preset label for the UI.'),
        },
        safeTool(async (input) => {
          const state = await manager.open({
            appSessionId: appSessionId(),
            url: input.url,
            viewport: input.viewport
              ? { ...input.viewport, deviceScaleFactor: input.viewport.deviceScaleFactor ?? 2 }
              : undefined,
            viewportMode: input.viewportMode ?? (input.viewport ? 'custom' : undefined),
          });
          return jsonResult({
            message:
              'Opened the page in the live DROIDEX browser. Call browser_read_page to see it and to get refs for browser_click, browser_select and browser_scroll.',
            ...stateForTool(state),
          });
        }),
      ),
      tool(
        'browser_read_page',
        [
          'Read the page as a compact accessibility tree, one element per line, such as - button "Sign in" [ref=e3].',
          'Use the refs with browser_click, browser_hover, browser_select, browser_scroll and browser_inspect.',
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
          "Read the main content of the page as light markdown: headings, paragraphs, lists, table rows and links.",
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
        'browser_reload',
        'Reload the current page in the live DROIDEX browser. Call browser_read_page to see it again.',
        {},
        safeTool(async () => {
          const state = await manager.reload(appSessionId());
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_back',
        'Go back one page in the live DROIDEX browser history. Call browser_read_page to see the page.',
        {},
        safeTool(async () => {
          const state = await manager.goBack(appSessionId());
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_forward',
        'Go forward one page in the live DROIDEX browser history. Call browser_read_page to see the page.',
        {},
        safeTool(async () => {
          const state = await manager.goForward(appSessionId());
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_screenshot',
        [
          'Capture the live DROIDEX browser as a JPEG: the viewport, one ref, a region, or the full page.',
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
        'Move the agent cursor and click in the live DROIDEX browser by ref or viewport coordinates. Prefer refs from browser_read_page.',
        {
          ref: z
            .string()
            .optional()
            .describe('Element ref from browser_read_page. Preferred when available.'),
          x: z.number().optional().describe('Viewport x coordinate when clicking by coordinate.'),
          y: z.number().optional().describe('Viewport y coordinate when clicking by coordinate.'),
        },
        safeTool(async (input) => {
          const state = await manager.click({
            appSessionId: appSessionId(),
            ref: input.ref,
            x: input.x,
            y: input.y,
          });
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_hover',
        'Move the trusted browser pointer over an element by ref or viewport coordinates.',
        {
          ref: z.string().optional().describe('Element ref from browser_read_page.'),
          x: z.number().optional().describe('Viewport x coordinate when hovering by coordinate.'),
          y: z.number().optional().describe('Viewport y coordinate when hovering by coordinate.'),
        },
        safeTool(async (input) => {
          const state = await manager.hover({
            appSessionId: appSessionId(),
            ref: input.ref,
            x: input.x,
            y: input.y,
          });
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_select',
        'Choose an option in a native select element by ref. The value may be the option value or visible label.',
        {
          ref: z.string().describe('Select element ref from browser_read_page.'),
          value: z.string().describe('Option value or exact visible label to select.'),
        },
        safeTool(async (input) => {
          const state = await manager.selectOption(appSessionId(), input.ref, input.value);
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_type',
        'Type text into the currently focused element in the live DROIDEX browser. Click or focus an input first.',
        {
          text: z.string().describe('Text to type into the currently focused browser element.'),
        },
        safeTool(async (input) => {
          const state = await manager.type(appSessionId(), input.text);
          return jsonResult(stateForTool(state));
        }),
      ),
      tool(
        'browser_keypress',
        'Press a key in the live DROIDEX browser.',
        {
          key: z
            .string()
            .min(1)
            .describe('Key name to press, such as Enter, Escape, Tab, ArrowDown.'),
        },
        safeTool(async (input) => {
          const state = await manager.keypress(appSessionId(), input.key);
          return jsonResult(stateForTool(state));
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
        'Scroll the live DROIDEX browser page, or inside the element a ref names. Call browser_read_page to see what came into view.',
        {
          direction: scrollDirectionSchema.describe('Direction to scroll.'),
          pixels: z.number().positive().max(4000).optional().describe('Scroll amount in pixels.'),
          ref: z.string().optional().describe('Optional ref inside a nested scroll container.'),
        },
        safeTool(async (input) => {
          const state = await manager.scroll(
            appSessionId(),
            input.direction,
            input.pixels,
            undefined,
            input.ref,
          );
          return jsonResult(stateForTool(state));
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
          'You never see the username or password: the values are injected securely in the app and are redacted from every snapshot. This lets you authorize a sign-in without reading the secret.',
          'Saved logins are strictly opt-in. Use only when a sign-in form is visible and the user has previously enabled saved logins and saved a credential for this site.',
          'Returns an error if saved logins are disabled or no credential is saved; in that case ask the user to sign in once and accept the save-login prompt. After filling, you may submit the form with browser_click or browser_keypress.',
        ].join(' '),
        {},
        safeTool(async () => {
          const state = await manager.fillCredentials(appSessionId());
          return jsonResult(stateForTool(state));
        }),
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
