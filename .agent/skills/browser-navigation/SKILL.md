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
3. Click, hover, select and scroll by ref with `droidex-browser___browser_click`, `droidex-browser___browser_hover`, `droidex-browser___browser_select` and `droidex-browser___browser_scroll`. `droidex-browser___browser_type` and `droidex-browser___browser_keypress` go to the focused element, so click the field first.
4. Use `droidex-browser___browser_reload` when the user asks to reload the visible page.
5. Read the page again after a navigation; a ref from an earlier page is refused rather than acted on.
6. Use `droidex-browser___browser_screenshot` only when visual inspection is needed. It returns a JPEG of the viewport, of one `ref`, of a `region`, or of the `full_page`, and states how image points convert to CSS pixels. Sensitive fields are painted over.

## Design Mode

When the user selects an element, sketches a region, annotates, or asks for design feedback on a visible page, use `droidex-browser___design-mode`.

Design Mode context is scoped to the active chat. Do not reuse selections from another chat.
