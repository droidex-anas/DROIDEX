# DROIDEX Browser rewrite

Status: design, 2026-09-30, revised after measurement and a GPT-6.1 Sol adversarial review. Branch: `browser/integration` (cut from `main` 134581b4). Every PR goes into `browser/integration`; nothing here merges into `main` without the user's explicit yes.

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

- **Idle is not the problem on a quiet page.** Both builds sit at noise level idle, visible or hidden (main process about 0.2 to 1.5 percent). On a page that animates, a hidden page keeps rendering at 60 frames a second in both builds (page about 3 percent, GPU about 1.5 percent per page), because the "hidden" host window is a shown, transparent window. Hiding also happens in the wrong order (`setVisible(false)` before throttling returns), so the page still reports itself visible.
- **Screenshots are 4x on a Retina Mac.** The capture scale defaults to 2 on top of the display's 2x: a 740x856 pane gives a 2960x3424 PNG (about 480 KB); a detached page gives 4800x3200 (about 735 KB) and 144 to 150 ms of main-process CPU.
- **`main` stores a full-page PNG for every evicted page** (about 400 KB each, 2.4x the eviction CPU of the old branch), and sends every agent result twice over IPC (about 33 KB extra).
- **`main`'s page snapshot has no node cap and misses real controls.** First snapshot 114 ms against 26 ms on the old branch, and on GitHub the search box and the Issues tab never appear as refs, so an agent must click by coordinates.
- **The old branch's cursor window costs 85 MB** for its own renderer and adds 140 to 320 ms to every visible click, hover and scroll.
- **Every page action waits two animation frames** before observing, which floors most actions at 25 to 50 ms and hangs in a view that is not in a window.
- **Bug on `main`:** an agent `open` while the pane is attached moves the page into the hidden host window, and the pane loses the page until the next attach.

The engine is fine. Chromium is the same one Chrome runs; the cost is in how DROIDEX hosts, hides, observes and screenshots pages. The old branch's security and lifecycle work is sound and is ported, not rebuilt.

## Decision: host pages in `<webview>`

`<webview>` is composited inside the app's own page, so app UI can sit on top of it. A `WebContentsView` is painted above the app, so nothing the app draws can overlap it. The spike measured both on the same window and page:

| | `<webview>` | `WebContentsView` |
|---|---|---|
| Composer, cursor, design marks drawn over the page | yes, plain DOM; clicks outside them reach the page | no; needs extra native layers or windows |
| A 1440x900 page scaled into a smaller pane | CSS `transform: scale()`; the page reports 1440x900 and host clicks land correctly | needs CDP emulation, which crashed `main` before |
| Hidden agent work | full rate inside a 1x1 clip; CDP screenshots work | needs the hidden host window |
| Cost on GitHub (guest / GPU, idle and scrolling) | same | same |
| Memory (guest / GPU) | 203 / 112 MB | 245 / 131 MB |

Electron discourages `<webview>` for stability. The spike found where it breaks, and the design follows those rules:

- Each `<webview>` is mounted once in a stable Browser host layer at the app root and never moved to another parent (moving it destroys the page).
- Text is inserted through the guest's `webContents`, never the host's (host `insertText` while the page has focus crashes the app renderer).
- Hidden pages live in a 1x1 clip container while an agent works; `visibility: hidden` stalls captures.
- Touch presets use guest touch events, not mouse-to-touch conversion (which hangs input).
- Emulation is sent only after `did-attach-webview` and only while the guest is not crashed, every CDP call has a timeout, and a touch preset reloads once so `ontouchstart` appears. `Emulation.setDeviceMetricsOverride` on a guest with no live renderer (before attach, or between a crash and the next load) crashes the main process, for guests exactly as for `WebContentsView`.
- Actions wait for the page's first paint: until then Chromium silently drops mouse presses, for CDP and `sendInputEvent` alike.
- The app shell must never reload while guests are live: a host reload destroys every page. Today `Cmd+R` reloads the shell (`electron/applicationMenu.cjs:7`); it becomes "reload the focused browser page", and shell reload leaves the production menu.

## Architecture

```
sidecar ──(private IPC)──> Electron main: Browser ──(CDP, attached once)──> page (guest)
   │  MCP "droidex-browser", tools browser_*        │  guest registry, action lifecycle, policy
   │                                                 │
   └──(WebSocket: slim state + activity)──> app renderer
        Browser host layer: one <webview> per live chat browser, mounted once
        Pane, inline card, cursor, design mode, full-screen composer: React over the page
```

**Main owns guests and every operation on them.** A guest exists only after main reserves it: the renderer asks main for a slot for a browser session, main returns a one-time token and a generation, and the renderer mounts `<webview src="about:blank">` carrying that token. `will-attach-webview` binds the token once (rejecting unknown, stale, repeated or wrong-host tokens) and replaces both objects outright: `webPreferences` becomes exactly the partition `persist:droidex-browser`, our preload, `sandbox`, `contextIsolation`, no Node and `disablePopups`, and `params` keeps only its `instanceId` with `src: 'about:blank'`. Forcing only the known-bad fields is not enough (the spike showed a page-chosen user agent and `allowpopups` getting through). The guest is bound in `web-contents-created`, which fires inside the attach, before any other code runs. The host renderer still controls its own guests after attach (it can set `src` or run script in them), so the app renderer stays inside the trust boundary; the token protects which chat a guest belongs to, not the renderer. Main navigates the bound guest itself, through the same authorization as any agent navigation; the renderer never picks a URL for a guest. Partition handlers (permissions, devices, downloads) are installed once, before the first guest, with per-guest ownership checks, and page-originated IPC keeps the main-frame sender check (`electron/main.cjs:980`).

**The action lifecycle is serialized per guest.** One queue per guest owns actions, captures, approvals and uploads, with cancellation, and every step rechecks the guest and document generation after each await (the old branch's `SerializedBrowserRuntime` and `nativeBrowserAgentActions` invariants carry over). A guest with work in flight is pinned: the LRU (3 live guests) never unmounts it, and new guests queue when every slot is pinned. Unmounting a guest invalidates its generation first and settles its pending work as failed. A reload from the URL does not bring back form state, POST results or history, and the agent is told so.

**The renderer owns where guests are shown.** The host layer positions each live `<webview>` over the pane's slot with CSS, or parks it: `visibility: hidden` when idle (0 animation frames, 0 CPU), a 1x1 clip while an agent works on it. The working guest's own background throttling is lifted for its operation and restored in `finally`, before it is hidden again (re-enabling throttling on a guest that is already hidden does not take effect). Lifting it on one guest never wakes the others.

**The sidecar talks to main directly.** Main spawns the sidecar (`electron/sidecar.cjs`); adding an `ipc` stdio gives a private channel. Requests carry a run-scoped id, payloads and queues are bounded, cancellation is explicit, and a sidecar restart settles every in-flight request as failed; nothing uncertain (a click, a submit, an upload) is ever replayed. The channel authenticates the process, not the session ids in its messages, so main checks each id against its registry. The renderer receives a slim per-chat state (`url`, `title`, `canGoBack`, `canGoForward`, `viewport`, `loading`) and one small activity event per action (tool, target label, point) for the cursor and the inline card. No refs, snapshots or screenshots in the store, and agent actions never force the pane open.

**Keyboard.** Guest key events do not reach the app's window listeners, so main routes app shortcuts from each guest's `before-input-event` to the renderer, and decides per shortcut who owns it: the focused page (Cmd+R, Cmd+L, Cmd+[ and ]), the composer, or design mode. Agent-injected chords never trigger app shortcuts.

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
| Act | `browser_fill` | Set a field by ref: text, select, checkbox, radio, date. Files need the user's approval (below). |
| Act | `browser_type` | Real keystrokes, optionally into a ref, optionally submit. |
| Act | `browser_press` | Keys or chords such as `Enter`, `cmd+a`, with repeat. |
| Act | `browser_scroll` | Scroll the page or a ref, or bring a ref into view. |
| Act | `browser_wait` | Wait for text, text gone, a ref, a URL, or a time, checked in the page. |
| View | `browser_viewport` | Pick a standard viewport and light or dark scheme. |
| Debug | `browser_console` | Console messages and uncaught errors with stacks, since the last read. |
| Debug | `browser_network` | Requests with method, URL, status, timing and size; no headers or bodies. |
| Debug | `browser_evaluate` | Run JavaScript on a site the user granted for developer tools; a bounded JSON result. |
| Debug | `browser_inspect` | One element: box, role and name, key attributes and styles, component and source file:line. |
| Design | `browser_selection` | Re-read the user's design-mode selection. |
| Batch | `browser_batch` | Up to 20 steps in order, stopping at the first failure. |

`browser_fill_login` stays as the saved-login feature, outside the core set.

**Results are short text.** One line saying what happened and what changed (new URL or title, a dialog handled, new console errors, a download), then a footer `[Title · url]` with the URL redacted like any other. No automatic snapshot and no JSON dumps. A blocked click names the element covering the target.

**Snapshots come from Chromium, bounded.** `Accessibility.getFullAXTree` through CDP with a depth limit and per-frame handling (out-of-process iframes included), capped in nodes processed and refs kept, then compacted without losing labels or states: unnamed wrappers dropped, single-child chains collapsed, per-word spans merged. Lines read like `- button "Sign in" [ref=e3]`. Box models are resolved only for the element being acted on, and every input still hit-tests its final target. No two-frame settle before every action.

**Refs are stable and never reused.** A public ref maps to guest generation, frame and document identity, and `backendNodeId`; AX nodes without a DOM node get no ref. A ref survives later snapshots while its node lives. A ref from an earlier document fails with "e12 belongs to the previous page; call browser_read_page", never a wrong click.

**Screenshots say their geometry.** JPEG, quality 80, captured once, saved once, returned as the image plus its path for harnesses that drop images. At the standard viewports (all at most 1440 wide) the image is the viewport at CSS size, one image pixel per CSS pixel. When a capture is larger than 1568 on its long edge (a big Fit pane, a full page) it is downscaled, and the result states the scale and, for crops, the origin, so coordinates convert exactly. PNG only on request, for pixel-exact design checks. A capture of a page that is shown CSS-scaled in the pane is slightly soft (the page is rendered at the scaled size), so pixel-exact design checks capture while the page is parked unscaled. Sensitive fields are masked before every capture and the capture fails closed if masking is not acknowledged or the document changes mid-capture (ported from the old branch), including design-mode composites.

**Every read path redacts.** AX values of sensitive fields, element attributes, console text, network URLs and the footer go through the same redaction as today's reads; network output has no headers or bodies. URL and key redaction is not a general secret detector, and the tool descriptions do not claim it is.

## Policy

- **Navigation keeps provenance.** Every transition is authorized where it happens (`will-navigate`, redirects, history, `window.open`), and the old branch's document-bound, single-use user-activation capability decides whether a transition is the user's (never interrupted) or the agent's (approved per autonomy, including navigations caused by an agent click, a script it triggered, a form submit or a redirect). Approval is bound to the guest and document and revalidated after the wait.
- **Developer tools need a grant per exact origin.** `browser_evaluate` and console stacks work only on an origin the user granted ("Let agents use developer tools on localhost:5173"), never by hostname pattern, never on the DROIDEX shell or bridge, and the grant is rechecked against the committed origin after every navigation. The grant says plainly what it relaxes: on that origin, script can read and change fields that the guarded input tools protect.
- **File uploads need the user.** `browser_fill` on a file input asks the user to approve the exact files and the destination origin, and revalidates the origin before assigning. Agent paste through `browser_press` is blocked on origins without a developer-tools grant.
- **Popups:** ordinary `target="_blank"` opens in the same guest in v1. The old branch's approved authentication popup (exact target, expiry, document generation, hardened window) stays, so OAuth flows that need `window.opener` keep working.
- **Saved logins, passkeys, permissions, cookie import, downloads, redaction:** ported from the old branch with their behaviour unchanged (OS-encrypted exact-origin logins with per-fill consent and Touch ID; passkey approval, which also needs its initialization and signed entitlement; camera and microphone per exact origin, revoked on navigation; cookie import suspends every affected guest; clearing data invalidates all affected work; safe download names).
- **Shared profile:** all chats share one partition, so cookies, storage and sign-outs are shared across chats. The UI and docs say so; nothing suggests per-chat isolation.

## Product behaviours with an owner

| Behaviour | Decision |
|---|---|
| Tabs, modifier-clicks | One page per chat in v1; modifier-clicks open in the same page. Tabs come later. |
| `alert`, `confirm`, `prompt` | Shown to the user in the pane when visible. During agent work with the pane hidden: `alert` is dismissed and reported, `confirm` and `prompt` are cancelled and reported, so the agent can ask the user. |
| Downloads | Existing save dialog and folder behaviour, progress and completion reported to the agent. |
| User upload dialogs | The native file dialog, for the user only. |
| Context menus | A native context menu on the page (copy, paste, open link, inspect when granted). |
| Guest crash | The pane shows a crashed state with Reload; pending work settles as failed; the agent is told. |
| Shell reload | Never while guests are live; see the `<webview>` rules. |

## Viewports

The agent works on a named viewport and sees it at native size; the user sees the same page scaled to fit.

| Name | Size | How |
|---|---|---|
| Fit | the pane's own size | the `<webview>` fills the pane |
| Desktop | 1440 x 900 | the `<webview>` is 1440x900, scaled with CSS to fit |
| Laptop | 1280 x 800 | same |
| Tablet | 820 x 1180 | same, plus guarded CDP touch and a mobile user agent |
| Phone | 390 x 844 | same, plus guarded CDP touch and a mobile user agent |

An agent turn defaults to Desktop unless the user picked a size; `browser_viewport` switches it, with no free-form sizes for agents. Desktop sizes need no emulation. Tablet and Phone are a narrow viewport with touch and a mobile user agent, not full device emulation; the tool says so. `main`'s lint ban on emulation becomes one guarded helper for the touch and user-agent calls. Device frames come later, drawn by the renderer around the page.

## The agent cursor

Drawn by React above the `<webview>`, from the activity events, so it never touches the page and never appears in the agent's own screenshots.

- It glides to the target on a compositor transition with the app's ease-out curve, about 120 to 220 ms by distance.
- While the agent works it rests in place and tilts about its tip.
- Input is never held for it. When the pane is hidden there is nothing to animate.
- The artwork is the traced glyph in `shared/browserAgentCursorDesign.json`.

The same component draws the cursor in the inline card.

## The inline Browser card

A run of browser tool calls in a turn becomes one Browser card in the transcript, claimed out of the Worked fold the way generated images are (`chatFeed.ts`, `chatFeedTurns.ts`), built from the existing card shell (`AgentMonitorCard`) and image frame (`GeneratedImageCard`), app tokens and `@droidex/icons`.

- Top: the page. While the agent works and the card is on screen, a CDP screencast capped at 480 px wide, JPEG 50, at most 4 frames a second and 150 KB a second, paced by acknowledgement and stopped the moment the card leaves the screen or the turn ends; otherwise the last frame. The agent cursor is drawn over it.
- Below: the page title, `domain · Browser`, an Open button that shows the page in the pane, and a menu (copy link, open in the default browser).
- While running, one line says what the agent is doing ("Clicking Sign in"), in the app's existing working-line style.

## Full screen: page first, composer on top

In full screen the `<webview>` fills the area. The chat's one composer floats over the bottom of the page as ordinary DOM, with one collapsed activity line above it that reuses the transcript's live step components (`ToolGroupItem` compact line, `ThinkingItem`, `WorkingIndicator`, `ActivityStatusGlyph`) and opens into the turn's steps. Pending steered messages show there too. The "Recent activity" box goes.

There is only ever one composer instance for the chat, never unmounted when the layout switches (PR 1, #379). When the host moves to `<webview>`, the composer's parent is a stable visible layer, popover positions are recalculated when the composer moves, and the `useObscuresNativeSurfaces` consumers that existed only because the page painted above the DOM are removed.

## Design mode

Design mode lives in the app. React draws the hover outline, numbered marks and the sketch layer above the `<webview>`; the page only answers "what element is here" (CDP `DOM.getNodeForLocation`) and gives boxes.

- **Select:** click an element; Shift+click adds or removes; drag marks an area; Up and Down walk to the parent and child.
- **Sketch:** press D and draw over the page; Escape steps back out.
- **Prompt:** marks become numbered chips in the one composer, referenced inline as @1, @2. No separate design composer. Chips show the number, a small crop and a label (component name, else accessible name or text, else tag); file:line in the tooltip.
- **Send:** a design prompt is an ordinary message. It queues like any other, can be edited, pulled back into the composer with its chips, or sent now. Today the queue row hides "Edit in composer" for design prompts and restoring a prompt drops its selections; both go away. The reference pack is built when the message is accepted, and a stale browser identity is rejected explicitly.
- **Context per mark:** a short inline line (kind, label, components, file:line, verified selector, text, box, note), one composite screenshot with the marks drawn in (masked like any capture), and small crops only for tiny marks. Fuller detail on demand through `browser_inspect`.
- **Source anchoring works again:** the React, Vue and Svelte lookups run in the page's main world through `executeInMainWorld`, on click only; React 19 dev builds use `_debugStack`, symbolicated in the sidecar.
- **Shortcut:** Cmd+Shift+D, rebindable in Settings.
- **Performance:** with design mode off nothing is registered in the page. Hover work is one coalesced hit test and one transform.

## Codex

Codex chats get the browser. Three places change, not one: `providers/codex/codexTools.ts` returns Codex `inputImage` content (and stops describing every non-session namespace as automations), `providers/codex/codexItems.ts` accepts image items instead of discarding them, and the Claude, Droid and Codex normalizers (`claudeEvents.ts`, `normalize.ts`, `codexItems.ts`) stop stringifying image blocks into transcript text. Image order and failure flags are preserved end to end.

## What gets deleted

From `main`: the 1,676-line page script, the hidden host window, eviction screenshots, crash recovery by remount, the renderer relay (`nativeBrowserAgent.ts`, the relay half of `nativeBrowser.ts`, `NativeBrowserRuntime`), the native bounds sync, `DesignModeComposer`, `browserComposerPosition`, `designModeTargeting`, `browserLoading`, `browserSessionIdentity`, the `droidmaxx-browser` name, and the second composer and "Recent activity" box in `BrowserFocusWorkspace`.

From the old branch, not ported: the cursor window and its modules, hidden-host eviction and recovery, the iframe fallback and `iframeDesignMode`, the dead sidecar DOM snapshot, and the Droid design-turn tool policy workaround. Navigation provenance and the authentication popup are kept.

Target: about 5,500 production lines for everything browser, against about 10,400 on `main` and 15,300 on the old branch.

## Plan

Small PRs into `browser/integration`. Each one deletes what it replaces, carries the policy for anything it makes usable, gets a GPT-6.1 Sol xhigh review and the bot reviews, and passes CI (every check now runs on `browser/integration` PRs). Anything that launches a build for checking runs in the background, never on the user's screen.

Policy is ported with the PR that first needs it, not onto `main`'s current host first: the old navigation policy depends on the view lifecycle and the agent-action pipeline, so porting it onto code the next PR deletes would mean porting half of that host too.

1. **One composer** (#379, merged). The composer is never unmounted when the pane switches.
2. **Spikes** (done; results in the appendix). Guest input under CSS scale, guest emulation, throttling across guests, token binding.
3. **Browser host on `<webview>`, with its session policy.** Reservation tokens and guest registry, hardening, pane placement, parking, pinned LRU, crash state, keyboard routing, the `Cmd+R` fix, and the partition handlers (permissions per exact origin, downloads, devices), redaction, and the user side of navigation provenance. Replaces `WebContentsView` hosting, the hidden host window, eviction screenshots and native bounds sync.
4. **Private sidecar channel.** Bounded IPC with run-scoped ids and restart settlement; today's actions move off the renderer relay unchanged.
5. **Reading.** AX snapshots, refs, `browser_read_page`, `browser_find`, `browser_read_text`, `browser_screenshot` with masking and stated geometry. Replaces the page script's snapshot.
6. **Acting, with agent navigation approval.** `browser_open`, click, hover, fill (file consent), type, press, scroll, wait, batch, with first-paint waits, hit-testing, sensitive-typing blocks, authentication checks, agent navigation approval per origin and the harness deferral for browser tools. Deletes the rest of the page script.
7. **Viewports.** Standard sizes, CSS scale to fit, guarded touch and user agent, `browser_viewport`, the viewport menu.
8. **Debug tools.** Console, network, evaluate, inspect, with the per-origin grant.
9. **Cursor and inline card.** The React cursor in the pane and in the card, the bounded screencast, the pane stops auto-opening.
10. **Full screen.** Page-first layout, the composer floating over the page, one collapsed activity line with pending steers; Mission Control included.
11. **Design mode.** App-owned selection, chips in the composer, sketch, source anchoring, design prompts through the normal queue.
12. **Saved logins, passkeys, cookie import and the Browser settings page**, trimmed and renamed.
13. **Codex.** The three changes above.
14. **Later:** tabs, and device frames for Tablet and Phone.

## Performance contract

- Idle with the pane showing a quiet page: main-process browser work at noise level; no timers or listeners from the browser.
- Parked pages throttled unless an agent is working on them.
- An agent turn with the pane hidden: nothing appears on screen and nothing takes focus.
- No per-token browser work in the renderer; the only per-frame renderer work is the inline card's preview image, within the screencast caps above, while the card is on screen.
- Screenshots at or under 1568 px, JPEG, geometry stated.
- Measured in a background build before and after PRs 3, 5, 6, 9 and 10, plus `perf:replay`, `perf:compare` and `perf:gates`.

## Appendix: spike facts and open items

Verified on Electron 39.8.10:

- `<webview>` overlay: host DOM draws above the guest; host CDP clicks outside the overlay reach the guest at the right point; guest `insertText`, `paste` and CDP IME work.
- CSS `transform: scale(0.5)` on a 1440x900 `<webview>`: the page reports 1440x900, `min-width: 1200px` matches, a host click lands on the right element. `zoom` also works but drops the pixel ratio to 1.
- Hidden: `visibility: hidden` gives about 2 animation frames a second and captures hang; a 1x1 clip gives 60 frames a second and full-size captures.
- Lifecycle: moving the element to another parent recreates the guest and loses the page; a guest crash leaves the host alive and `reload()` recovers it; a host reload destroys all guests.
- CDP emulation on `WebContentsView`: safe once a navigation has started; an emulation call on a page with no live frame crashes the main process. Guard: `!isDestroyed() && !isCrashed() && (isLoading() || getURL() !== '')`.

Spike results (PR 2), Electron 39.8.10:

- Guest input: CDP `Input.dispatchMouseEvent` in the guest's own CSS pixels hits the exact element at CSS scale 0.5, 0.75 and 1 (edge points included), with trusted pointer and click events in 5 to 17 ms. `Input.insertText` and key events work. Presses before the guest's first paint are silently dropped. `Page.captureScreenshot` with `clip.scale = 1 / devicePixelRatio` returns the CSS-sized image; captures of a CSS-scaled guest are slightly soft.
- Guest emulation: touch, user agent and device metrics apply when sent on the guest's first navigation; touch taps land exactly; `ontouchstart` needs one reload; `navigator.maxTouchPoints` stays 0 in a guest. Device metrics before attach or on a crashed guest crash the main process; touch dispatch before commit hangs.
- Throttling: lifting throttling on one guest, or on the host, never wakes idle guests (`visibility: hidden`: 0 animation frames, about 1 timer a second, 0 CPU). With the window hidden, only a guest's own flag keeps it running. Re-enabling throttling on an already hidden guest does not take effect.
- Token binding: a token in `src` (fragment or query) or the partition reaches `will-attach-webview`; forged, reused and wrong-host tokens never attach; only a full rewrite of `webPreferences` and `params` holds (a partial one let a page-chosen user agent and `allowpopups` through); `web-contents-created` fires inside the attach, so binding there has no race.

Still not verified: the sidecar IPC channel in a packaged build, and signed passkeys.
