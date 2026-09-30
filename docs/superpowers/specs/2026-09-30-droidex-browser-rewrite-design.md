# DROIDEX Browser rewrite

Status: design, 2026-09-30, revised after measurement. Branch: `browser/integration` (cut from `main` 134581b4). Every PR goes into `browser/integration`; nothing here merges into `main` without the user's explicit yes.

## What the user asked for

1. A browser that feels light and responsive, for the user and for agents.
2. Clean UI and UX in DROIDEX's own design language, with plain names: "Browser" in the app, `browser_*` for agent tools.
3. Agents that work in the browser while the user is not looking, shown in the chat as an inline Browser card with the page and a small blue agent cursor.
4. The agent cursor glides to each click and tilts gently about its tip while the agent works.
5. Standard viewports for agents (a real desktop, laptop, tablet or phone size), shown to the user scaled to fit, with device frames later.
6. A much better design mode: select elements, mark areas, sketch, and send one prompt about them.
7. In full screen, the page uses the whole area, the composer floats over it, and the agent's steps are one clean collapsed line.
8. Agents can debug a web app: console, network, JavaScript, element inspection.
9. Old dead and tangled code is deleted, not left beside the new code.
10. Two bugs: a typed composer message is lost when the pane switches between full screen and the docked panel, and a design-mode prompt cannot be edited, put back into the composer, or sent now.

## What we measured

Isolated builds of `main` (134581b4) and the old `feature/browser-agent-controls` work, run in the background on the same Mac, GitHub as the test page. CPU is percent of one core.

- **Idle is not the problem on a quiet page.** Both builds sit at noise level idle, visible or hidden (main process about 0.2 to 1.5 percent). On a page that animates, a hidden page keeps rendering at 60 frames a second in both builds (page about 3 percent, GPU about 1.5 percent per page), because the "hidden" host window is a shown, transparent window. Hiding is also done in the wrong order (`setVisible(false)` before throttling returns), so the page still reports itself visible.
- **Screenshots are 4x on a Retina Mac.** The capture scale defaults to 2 on top of the display's 2x: a 740x856 pane gives a 2960x3424 PNG (about 480 KB); a detached page gives 4800x3200 (about 735 KB) and 144 to 150 ms of main-process CPU.
- **`main` stores a full-page PNG for every evicted page** (about 400 KB each, 2.4x the eviction CPU of the old branch), and sends every agent result twice over IPC (about 33 KB extra).
- **`main`'s page snapshot has no node cap and misses real controls.** First snapshot 114 ms against 26 ms on the old branch, and on GitHub the search box and the Issues tab never appear as refs, so an agent must click by coordinates.
- **The old branch's cursor window costs 85 MB** for its own renderer and adds 140 to 320 ms to every visible click, hover and scroll.
- **Every page action waits two animation frames** before observing, which floors most actions at 25 to 50 ms and hangs in a view that is not in a window.
- **Bug on `main`:** an agent `open` while the pane is attached moves the page into the hidden host window, and the pane loses the page until the next attach.

The engine is fine. Chromium is the same one Chrome runs; the cost is in how DROIDEX hosts, hides, observes and screenshots pages.

## Decision: host pages in `<webview>`

`<webview>` is composited inside the app's own page, so app UI can sit on top of it. A `WebContentsView` is painted above the app, so nothing the app draws can overlap it. The spike measured `<webview>` against `WebContentsView` on the same window and page:

| | `<webview>` | `WebContentsView` |
|---|---|---|
| Composer, cursor, design marks drawn over the page | yes, plain DOM; clicks outside them reach the page | no; needs extra native layers or windows |
| A 1440x900 page scaled into a smaller pane | CSS `transform: scale()`; the page reports 1440x900 and clicks land correctly | needs CDP emulation, which crashed `main` before |
| Hidden agent work | runs at full rate inside a 1x1 clip; CDP screenshots work | needs the hidden host window |
| Cost on GitHub (guest / GPU, idle and scrolling) | same | same |
| Memory (guest / GPU) | 203 / 112 MB | 245 / 131 MB |

Electron discourages `<webview>` for stability. The spike found exactly where it breaks, and the design follows those rules:

- Each `<webview>` is mounted once in a stable Browser host layer at the app root and never moved to another parent (moving it destroys the page).
- Text is inserted through the guest's `webContents`, never the host's (host `insertText` while the page has focus crashes the app renderer).
- Hidden pages live in a 1x1 clip container while an agent works; `visibility: hidden` stalls captures.
- Touch presets use guest touch events, not mouse-to-touch conversion (which hangs input).
- Any CDP emulation call is guarded: only when the page is not crashed and has started a navigation (an emulation call on a page with no live frame crashed the main process).

## Architecture

```
sidecar ──(private IPC)──> Electron main: Browser ──(CDP, attached once)──> page (guest)
   │  MCP "droidex-browser", tools browser_*        │  guest registry, actions, policy
   │                                                 │
   └──(WebSocket: slim state + activity)──> app renderer
        Browser host layer: one <webview> per live chat browser, mounted once
        Pane, inline card, cursor, design mode, full-screen composer: React over the page
```

**The renderer owns where pages are shown; main owns what agents do.** The Browser host layer keeps each live `<webview>` mounted in one place and positions it over the pane's slot with CSS, or parks it: `visibility: hidden` when idle (Chromium throttles it), a 1x1 clip while an agent works on it (full rate, captures work). A small LRU (3 live pages) unmounts the rest; unmounting discards page state, and the next attach or action reloads from the URL.

**Main registers guests and drives them.** `will-attach-webview` enforces the partition `persist:droidex-browser`, our preload, `sandbox`, `contextIsolation`, no Node, no popups, and an http or https `src`. After `did-attach-webview`, the renderer reports which browser session the guest belongs to; main checks the guest's host is the main window before accepting it. Main attaches CDP to the guest once and keeps it. Background throttling is off only while an agent turn uses that page.

**The sidecar talks to main directly.** Main spawns the sidecar (`electron/sidecar.cjs`); adding an `ipc` stdio gives a private channel. Agent requests go sidecar to main and back, never through React. The renderer receives a slim per-chat state (`url`, `title`, `canGoBack`, `canGoForward`, `viewport`, `loading`) and one small activity event per action (tool, target label, point) for the cursor and the inline card. No refs, snapshots or screenshots in the store, and agent actions never force the pane open.

## Agent tools

Server key `droidex-browser`; every tool is named `browser_*` so the name stays clear in every harness (Claude shows `mcp__droidex-browser__browser_click`, Droid `droidex-browser___browser_click`, Codex the bare tool name). Refs look like `e12`.

| Group | Tool | What it does |
|---|---|---|
| Go | `browser_open` | Open a URL, or go `back`, `forward`, `reload`. |
| Read | `browser_read_page` | The page as a compact accessibility tree with refs; optional `ref` subtree, `filter` interactive or all, `max_chars`. |
| Read | `browser_find` | Tree lines matching text or a regex, with their parents, up to 20. |
| Read | `browser_read_text` | The main content as light markdown. |
| Read | `browser_screenshot` | A JPEG of the viewport, or of one `ref` or region. |
| Act | `browser_click` | Click a ref or a point; button, count, modifiers. |
| Act | `browser_hover` | Hover a ref or a point. |
| Act | `browser_fill` | Set a field by ref: text, select, checkbox, radio, date, file. |
| Act | `browser_type` | Real keystrokes, optionally into a ref, optionally submit. |
| Act | `browser_press` | Keys or chords such as `Enter`, `cmd+a`, with repeat. |
| Act | `browser_scroll` | Scroll the page or a ref, or bring a ref into view. |
| Act | `browser_wait` | Wait for text, text gone, a ref, a URL, or a time, checked in the page. |
| View | `browser_viewport` | Pick a standard viewport and light or dark scheme. |
| Debug | `browser_console` | Console messages and uncaught errors with stacks, since the last read. |
| Debug | `browser_network` | Requests with status, timing and size; one request's detail by id. |
| Debug | `browser_evaluate` | Run JavaScript and return a bounded JSON result. |
| Debug | `browser_inspect` | One element: box, role and name, key attributes and styles, component and source file:line. |
| Design | `browser_selection` | Re-read the user's design-mode selection. |
| Batch | `browser_batch` | Up to 20 steps in order, stopping at the first failure. |

`browser_fill_login` stays as the saved-login feature, outside the core set.

**Results are short text.** One line saying what happened and what changed (new URL or title, a dialog handled, new console errors, a download), then a footer `[Title · url]`. No automatic snapshot and no JSON dumps. A blocked click names the element covering the target.

**Snapshots come from Chromium.** `Accessibility.getFullAXTree` through CDP, compacted: unnamed wrappers dropped, single-child chains collapsed, per-word spans merged. Lines read like `- button "Sign in" [ref=e3]`. Box models are resolved only for the element being acted on. No two-frame settle before every action; actions wait for what they need (a navigation, a network idle window, or nothing).

**Refs are stable.** Each ref maps to the node's `backendNodeId` and survives later snapshots while the node lives. A ref from an earlier document fails with "e12 belongs to the previous page; call browser_read_page", never a wrong click.

**Screenshots are JPEG at CSS scale.** One image pixel is one CSS pixel (CDP clip scale `1 / devicePixelRatio`), so coordinates need no conversion. Long edge 1280 by default, never above 1568, quality 80. Captured once, saved once, returned as the image plus its path for harnesses that drop images. PNG only on request, for pixel-exact design checks.

**Debug tools are honest about policy.** `browser_evaluate`, network detail and console stacks work by default on local development origins (localhost, 127.0.0.1, `*.test`, `*.localhost`). Elsewhere they need the Browser setting "Let agents use developer tools", and the tool says so instead of failing silently. Redaction of sensitive fields, URL secrets and credentials stays.

**Codex gets the browser.** `startLocalMcpServers` gives Codex no browser today; the Codex tool bridge (`providers/codex/codexTools.ts`) gains image content so the same tools work there.

## Viewports

The agent works on a named viewport and sees it at native size; the user sees the same page scaled to fit.

| Name | Size | How |
|---|---|---|
| Fit | the pane's own size | the `<webview>` fills the pane |
| Desktop | 1440 x 900 | the `<webview>` is 1440x900, scaled with CSS to fit |
| Laptop | 1280 x 800 | same |
| Tablet | 820 x 1180 | same, plus guarded CDP touch and a mobile user agent |
| Phone | 390 x 844 | same, plus guarded CDP touch and a mobile user agent |

An agent turn defaults to Desktop unless the user picked a size; `browser_viewport` switches it, with no free-form sizes for agents. Desktop sizes need no emulation at all. Device frames for Tablet and Phone come later, drawn by the renderer around the page. `main`'s lint ban on emulation becomes a single guarded helper for the touch and user-agent calls.

## The agent cursor

Drawn by React above the `<webview>`, from the activity events, so it never touches the page and never appears in the agent's own screenshots.

- It glides to the target on a compositor transition with the app's ease-out curve, about 120 to 220 ms by distance.
- While the agent works it rests in place and tilts about its tip.
- Input is never held for it: main sends the event and the cursor animation runs alongside. When the pane is hidden there is nothing to animate.
- The artwork is the traced glyph in `shared/browserAgentCursorDesign.json`.

The same component draws the cursor in the inline card, so both show the same motion.

## The inline Browser card

A run of browser tool calls in a turn becomes one Browser card in the transcript, claimed out of the Worked fold the way generated images are (`chatFeed.ts`, `chatFeedTurns.ts`), built from the existing card shell (`AgentMonitorCard`) and image frame (`GeneratedImageCard`), app tokens and `@droidex/icons`.

- Top: the page. While the agent works and the card is on screen, a low-rate CDP screencast (about 480 px wide, JPEG 50, a frame when the page changes) with the agent cursor drawn over it; otherwise the last frame.
- Below: the page title, `domain · Browser`, an Open button that shows the page in the pane, and a menu (copy link, open in the default browser).
- While running, one line says what the agent is doing ("Clicking Sign in"), in the app's existing working-line style.

## Full screen: page first, composer on top

In full screen the `<webview>` fills the area. The chat's one composer floats over the bottom of the page as ordinary DOM, with one collapsed activity line above it that reuses the transcript's live step components (`ToolGroupItem` compact line, `ThinkingItem`, `WorkingIndicator`, `ActivityStatusGlyph`) and opens into the turn's steps. The "Recent activity" box goes.

There is only ever one composer instance for the chat. It is never unmounted when the layout switches; it is repositioned. That keeps the draft, attachments and selections, keeps one owner of queued-message delivery (today both composers can each send a queued message when a turn ends), and keeps pending steered messages visible in full screen.

## Design mode

Design mode lives in the app. React draws the hover outline, numbered marks and the sketch layer above the `<webview>`; the page only answers "what element is here" (CDP `DOM.getNodeForLocation`) and gives boxes.

- **Select:** click an element; Shift+click adds or removes; drag marks an area; Up and Down walk to the parent and child.
- **Sketch:** press D and draw over the page; Escape steps back out.
- **Prompt:** marks become numbered chips in the one composer, referenced inline as @1, @2. No separate design composer. Chips show the number, a small crop and a label (component name, else accessible name or text, else tag); file:line in the tooltip.
- **Send:** a design prompt is an ordinary message. It queues like any other, can be edited, pulled back into the composer with its chips, or sent now. Today the queue row hides "Edit in composer" for design prompts and restoring a prompt drops its selections; both go away.
- **Context per mark:** a short inline line (kind, label, components, file:line, verified selector, text, box, note), one composite screenshot with the marks drawn in, and small crops only for tiny marks. Fuller detail on demand through `browser_inspect`.
- **Source anchoring works again:** the React, Vue and Svelte lookups run in the page's main world through `executeInMainWorld`, on click only; React 19 dev builds use `_debugStack`, symbolicated in the sidecar.
- **Shortcut:** Cmd+Shift+D, rebindable in Settings.
- **Performance:** with design mode off nothing is registered in the page. Hover work is one coalesced hit test and one transform.

## Security that stays

- Guests are sandboxed, context-isolated, without Node, in their own partition; `will-attach-webview` rejects anything else, and only the app's own renderer may create a `<webview>` or call browser IPC.
- Navigation: http and https only, no embedded credentials, never the DROIDEX shell. An agent's navigation to a new origin, including one caused by an agent click, is approved per autonomy. The user's own navigation is never interrupted.
- Saved logins: OS-encrypted, exact-origin, per-fill consent with Touch ID where available, revalidated before filling. Agents cannot type into sensitive fields.
- Authentication and passkey approvals, camera and microphone grants per exact origin and revoked on navigation, cookie import plans, safe download names, and redaction of sensitive fields and URL secrets in reads and screenshots.

These modules come from the old branch with new names and less ceremony; their behaviour does not change.

## What gets deleted

From `main`: the 1,676-line page script, the hidden host window, eviction screenshots, crash recovery by remount, the renderer relay (`nativeBrowserAgent.ts`, the relay half of `nativeBrowser.ts`, `NativeBrowserRuntime`), the native bounds sync, `DesignModeComposer`, `browserComposerPosition`, `designModeTargeting`, `browserLoading`, `browserSessionIdentity`, the `droidmaxx-browser` name, and the second composer and "Recent activity" box in `BrowserFocusWorkspace`.

From the old branch, not ported: the cursor window and its modules, hidden-host eviction and recovery, navigation provenance tracking, the iframe fallback and `iframeDesignMode`, the dead sidecar DOM snapshot, and the Droid design-turn tool policy workaround.

Target: about 5,000 production lines for everything browser, against about 10,400 on `main` and 15,300 on the old branch.

## Plan

Small PRs into `browser/integration`. Each one deletes what it replaces, gets a GPT-6.1 Sol xhigh review and the bot reviews, and passes the gates (`typecheck`, `sidecar:typecheck`, lint, tests, `quality:*`, `docs:check`, `perf:gates`, bundle budgets). Anything that launches a build for checking runs in the background, never on the user's screen.

1. **One composer.** The chat's composer is never unmounted when the pane switches between full screen and the docked panel. Fixes the lost draft and the double queue delivery now, before the host changes.
2. **Browser host on `<webview>`.** The host layer, guest registration and hardening in main, pane placement, parking, LRU. Replaces `WebContentsView` hosting, the hidden host window, eviction screenshots and native bounds sync.
3. **Agent core.** Private sidecar channel, CDP attached once, the Go, Read, Act and Batch tools, stable refs, JPEG screenshots, slim renderer state. Replaces the renderer relay and the 1,676-line page script.
4. **Viewports.** Standard sizes, CSS scale to fit, guarded touch and user agent, `browser_viewport`, the viewport menu.
5. **Debug tools.** Console, network, evaluate, inspect, with the policy above.
6. **Cursor and inline card.** The React cursor in the pane and in the transcript card, screencast preview, the pane stops auto-opening.
7. **Full screen.** Page-first layout, the composer floating over the page, one collapsed activity line.
8. **Design mode.** App-owned selection, chips in the composer, sketch, source anchoring, design prompts through the normal queue.
9. **Security features from the old branch.** Saved logins, passkeys, permissions and the Browser settings page, trimmed and renamed.
10. **Codex.** Browser tools in Codex chats.
11. **Later:** device frames for Tablet and Phone.

## Performance contract

- Idle with the pane showing a quiet page: main-process browser work at noise level; no timers or listeners from the browser.
- Parked pages throttled unless an agent is working on them.
- An agent turn with the pane hidden: nothing appears on screen and nothing takes focus.
- No per-token or per-frame browser work in the renderer.
- Screenshots at or under 1568 px, JPEG, CSS scale.
- Measured in a background build before and after PRs 2, 3, 6 and 7, plus `perf:replay`, `perf:compare` and `perf:gates`.

## Appendix: spike facts the implementation relies on

- `<webview>` overlay: host DOM draws above the guest; host CDP clicks outside the overlay reach the guest at the right point; guest `insertText`, `paste` and CDP IME work.
- CSS `transform: scale(0.5)` on a 1440x900 `<webview>`: the page reports 1440x900, `min-width: 1200px` matches, a host click lands on the right element. `zoom` also works but drops the pixel ratio to 1.
- Hidden: `visibility: hidden` gives about 2 animation frames a second and captures hang; a 1x1 clip gives 60 frames a second and full-size captures.
- Lifecycle: moving the element to another parent recreates the guest and loses the page; a guest crash leaves the host alive and `reload()` recovers it; a host reload destroys all guests.
- CDP emulation on `WebContentsView` (kept for the touch and user-agent calls): safe once a navigation has started; any emulation call on a page with no live frame (never navigated, or crashed and not yet reloading) crashes the main process. Guard: `!isDestroyed() && !isCrashed() && (isLoading() || getURL() !== '')`.
- Not yet verified: CDP input to a guest in CSS coordinates under a CSS-scaled `<webview>` (host clicks were verified), and CDP emulation inside a guest.
