---
name: browser-navigation
version: 1.0.0
description: |
  Control the chat's DROIDEX Browser page through the session-scoped droidex-browser tools.
  Use when the user asks to open, navigate, inspect, click, type, scroll, screenshot, annotate, or control a web page.
---

# Browser Navigation In DROIDEX

Use the DROIDEX Browser tools. They drive the chat's own browser page, which the user can open in the pane and watch.

Do not use `Read`, `FetchUrl`, `curl`, or `agent-browser` for browser interaction. Reading a URL is not opening the browser.
If the user names a site or domain, do not ask what URL to open. Call `browser_open` with that site directly.

## Workflow

1. Call `droidex-browser___browser_open` with the target `url`. Bare domains like `skeina.tech` are accepted.
2. Call `droidex-browser___browser_read_page` to see the page as a short tree with refs such as `[ref=e12]`; use `filter: "interactive"` for just the controls, or `droidex-browser___browser_find` to look for text. To read an article or results, `droidex-browser___browser_read_text` returns the main content as markdown, without refs.
3. Act by ref: `droidex-browser___browser_click` (button, count, modifiers), `droidex-browser___browser_hover`, `droidex-browser___browser_fill` to set a field in one step (text, select, checkbox, radio, date), `droidex-browser___browser_type` to type text into a ref as text input (with `submit` to press Enter), `droidex-browser___browser_press` for keys and chords on whatever has focus, and `droidex-browser___browser_scroll`. A click on a covered element is refused and names what covers it. Each action answers in a line or two and ends with `[Title · url]`.
4. When you already have the refs for several steps, such as filling a form and submitting it, send them as one `droidex-browser___browser_batch`; it stops at the first step that fails. After an action that loads or changes something, `droidex-browser___browser_wait` returns as soon as every condition you give holds: text on the page (`text`), text gone (`textGone`), a `ref` on the page, or a fragment in the address (`urlIncludes`). With none of them, it waits for `timeoutMs`.
5. Use `droidex-browser___browser_open` with `action: "back"`, `"forward"` or `"reload"` to move through history or reload.
6. Read the page again after a navigation; a ref from an earlier page is refused rather than acted on.
7. Use `droidex-browser___browser_screenshot` only when visual inspection is needed. It returns a JPEG (a PNG with `format: "png"`) of the viewport, of one `ref`, of a `region`, or of the `full_page`, and states how image points convert to CSS pixels. Sensitive fields are painted over.

## Design Mode

When the user selects an element, sketches a region, annotates, or asks for design feedback on a visible page, use `droidex-browser___design-mode`.

Design Mode context is scoped to the active chat. Do not reuse selections from another chat.
