import { createSdkMcpServer, tool } from '@factory/droid-sdk';
import { z } from 'zod';
import type { BrowserSessionManager } from './BrowserSessionManager.js';
import type { BrowserState, BrowserViewportMode, DesignReference } from './types.js';
import { redactBrowserUrl } from './browserUrl.js';
import { jsonResult, safeTool } from '../mcpToolUtils.js';
import {
  browserActs,
  clickShape,
  fillShape,
  MAX_BATCH_STEPS,
  pointShape,
  pressShape,
  said,
  scrollShape,
  stepSchema,
  typeShape,
  waitShape,
} from './browserActionTools.js';
import { consoleText, inspectionText, networkText } from './browserDebugText.js';

const viewportModeSchema = z.enum(['fit', 'desktop', 'laptop', 'tablet', 'mobile']);

export function createBrowserMcpServer(
  manager: BrowserSessionManager,
  appSessionIdForTool: () => string | undefined,
) {
  const appSessionId = () => {
    const id = appSessionIdForTool();
    if (!id) throw new Error('Browser tools are not attached to a live DROIDEX session yet.');
    return id;
  };
  const { act, batch } = browserActs(manager);

  // What browser_viewport says once a size is in place.
  async function useSize(size: BrowserViewportMode): Promise<string> {
    const { viewport, viewportMode } = await manager.useViewport(appSessionId(), size);
    if (viewportMode !== size)
      return `The user switched the page to ${viewportMode} meanwhile; browser_screenshot states its size.`;
    if (size === 'fit')
      return "The page follows the user's pane; browser_screenshot states its size.";
    const laidOut = `The page is laid out at ${size} size, ${String(viewport.width)} × ${String(viewport.height)} CSS px`;
    if (size === 'tablet' || size === 'mobile')
      return `${laidOut}, as a touch device. Reload it if the site picks its version for the device on the server.`;
    return `${laidOut}.`;
  }

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
        },
        safeTool(async (input) => {
          const id = appSessionId();
          if (input.action === 'back')
            return said({ done: 'Went back.', outcome: await manager.goBack(id) });
          if (input.action === 'forward')
            return said({ done: 'Went forward.', outcome: await manager.goForward(id) });
          if (input.action === 'reload')
            return said({ done: 'Reloaded the page.', outcome: await manager.reload(id) });
          if (!input.url) throw new Error('Pass a url, or an action: back, forward or reload.');
          // A browser the agent starts is on Fit, so the page takes the pane's size.
          const outcome = await manager.open({ appSessionId: id, url: input.url });
          return said({ done: 'Opened the page.', outcome });
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
        clickShape,
        safeTool(async (input) => said(await act.click(appSessionId(), input))),
      ),
      tool(
        'browser_hover',
        'Move the pointer over an element by ref or viewport x and y, to open menus or tooltips.',
        pointShape,
        safeTool(async (input) => said(await act.hover(appSessionId(), input))),
      ),
      tool(
        'browser_fill',
        [
          'Set a field by ref in one step: text, a select option (its value or visible label), a checkbox or radio (true or false), or a date (YYYY-MM-DD).',
          'Frameworks see the change as typed input. To type into the focused element use browser_type; for keys, browser_press.',
        ].join(' '),
        fillShape,
        safeTool(async (input) => said(await act.fill(appSessionId(), input))),
      ),
      tool(
        'browser_type',
        'Type text into a field by ref, or into whatever has focus, and optionally press Enter after. The page gets it as text input, not a key event per character; for keys use browser_press.',
        typeShape,
        safeTool(async (input) => said(await act.type(appSessionId(), input))),
      ),
      tool(
        'browser_press',
        'Press a key or chord on whatever has focus, such as Enter, Escape, Tab, ArrowDown, Shift+Tab or Meta+a.',
        pressShape,
        safeTool(async (input) => said(await act.press(appSessionId(), input))),
      ),
      tool(
        'browser_viewport',
        [
          "Lay the page out at a standard size: desktop (1440×900), laptop (1280×800), tablet (820×1180) or mobile (390×844); fit, where a browser you open starts, follows the size of the user's pane.",
          'The page reflows to it; the user sees the same page scaled to fit their pane. Use it to check a responsive layout.',
          "Tablet and mobile also tell the page it is a touch device (touch points, a coarse pointer) with Chrome for Android's user agent; your clicks stay mouse clicks. A scheme asks the page for its light or dark look.",
        ].join(' '),
        {
          size: viewportModeSchema.optional().describe('The size to lay the page out at.'),
          scheme: z
            .enum(['light', 'dark', 'auto'])
            .optional()
            .describe(
              "The colour scheme to ask the page for, until the app quits; auto follows the system's setting.",
            ),
        },
        safeTool(async (input) => {
          const answers: string[] = [];
          if (input.size) answers.push(await useSize(input.size));
          if (input.scheme) {
            await manager.useColorScheme(appSessionId(), input.scheme);
            answers.push(
              input.scheme === 'auto'
                ? "The page follows the system's light or dark setting."
                : `The page is asked for its ${input.scheme} scheme.`,
            );
          }
          return answers.join(' ') || 'Pass a size, a scheme, or both.';
        }),
      ),
      tool(
        'browser_scroll',
        'Scroll the page, or inside the element a ref names; a ref with no direction is only brought into view. Then read the page again to see what came into view.',
        scrollShape,
        safeTool(async (input) => said(await act.scroll(appSessionId(), input))),
      ),
      tool(
        'browser_wait',
        [
          'Wait until text is on the page, text is gone, a ref is on the page, or the address has a fragment; with none of them, wait for the time.',
          'Checked again as the page changes, so it returns as soon as everything holds.',
        ].join(' '),
        waitShape,
        safeTool(async (input) => said(await act.wait(appSessionId(), input))),
      ),
      tool(
        'browser_batch',
        [
          `Run up to ${String(MAX_BATCH_STEPS)} actions in order in one call, such as filling a form, submitting it and waiting for the result.`,
          'Each step is { action, ...the fields of browser_<action> }. It stops at the first step that fails and answers one line per step, then [Title · url].',
        ].join(' '),
        {
          steps: z.array(stepSchema).min(1).max(MAX_BATCH_STEPS).describe('The actions, in order.'),
        },
        safeTool(async (input) => batch(appSessionId(), input.steps)),
      ),
      tool(
        'browser_inspect',
        [
          'Look at one element: its role and name, box, key attributes, the computed styles that say how it looks (colours, font, display, spacing), its text and its markup.',
          'Pass a ref from browser_read_page, or a CSS selector. Field values, tokens and sensitive URL parts are redacted.',
        ].join(' '),
        {
          ref: z.string().optional().describe('Element ref from browser_read_page.'),
          selector: z.string().optional().describe('CSS selector when no ref is available.'),
        },
        safeTool(async (input) => inspectionText(await manager.inspect(appSessionId(), input))),
      ),
      tool(
        'browser_network',
        [
          'The requests the page finished since you last read them, the newest 100 at most: status or failure, method, URL, type, how long each took once it was sent, and its size when the server stated one.',
          'No headers or bodies; credentials and sensitive URL parts are redacted.',
        ].join(' '),
        {},
        safeTool(async () => networkText(await manager.network(appSessionId()))),
      ),
      tool(
        'browser_console',
        [
          'The console messages and uncaught errors since you last read them, the newest 100 at most: level, message and where it came from.',
          "Messages are length-limited, and the usual shapes of a credential in them (in a URL, or after a name such as token=) are redacted; this is the page's own text, not a guarantee that no secret is in it.",
        ].join(' '),
        {},
        safeTool(async () => consoleText(await manager.console(appSessionId()))),
      ),
      tool(
        'browser_evaluate',
        [
          'Run JavaScript in the page. The script is the body of an async function: `return` what you want back and `await` as needed. The result comes back as JSON, cut at 4,000 characters, within 5 seconds.',
          'It works only on a site the user has allowed for developer tools: the first call on a site asks them, and their answer stands until they quit the app.',
          'Use it for what the other tools cannot reach, such as app state, storage or a computed value. Read and act with the other tools.',
        ].join(' '),
        { script: z.string().describe('The function body, such as `return document.title`.') },
        safeTool(async (input) => (await manager.evaluate(appSessionId(), input.script)).text),
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
          said({
            done: 'Filled the saved login.',
            outcome: await manager.fillCredentials(appSessionId()),
          }),
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

function stateForTool(
  state: BrowserState,
  designReferences: DesignReference[] = [],
): Record<string, unknown> {
  return {
    ok: true,
    url: redactBrowserUrl(state.url),
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
    url: redactBrowserUrl(ref.url),
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
