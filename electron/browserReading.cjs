// What agents read from a page: Chromium's accessibility tree, compacted into
// short lines such as `- button "Sign in" [ref=e3]`. A ref names one DOM node
// in one document and is never reused; a ref from a document that has since
// gone fails plainly instead of acting on something else.

const vm = require('node:vm');
const { refFor, knownRef, forgetRefs } = require('./browserRefs.cjs');
const { createBrowserMasking, fieldOf } = require('./browserMasking.cjs');
const { cleanText, TEXT_ROLES } = require('./browserText.cjs');

const MAX_NODES = 20_000;
const MAX_REFS = 5_000;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_FIND_RESULTS = 20;
const MAX_NAME_CHARS = 200;
const REGEX_TIME_LIMIT_MS = 250;

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'listbox',
  'treeitem',
]);
// Unnamed structure that only wraps what is inside it.
const WRAPPER_ROLES = new Set([
  'generic',
  'none',
  'presentation',
  'group',
  'section',
  'paragraph',
  'div',
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
  'LabelText',
  'MenuListPopup',
  'strong',
  'emphasis',
  'mark',
]);
// Fields whose inside only repeats their value.
const LEAF_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'slider']);
const STATE_PROPERTIES = ['checked', 'pressed', 'selected', 'expanded', 'disabled', 'required'];
function createBrowserReading({ runWithWebContentsDebugger, savedSecretsFor, redactUrl }) {
  const masking = createBrowserMasking({ savedSecretsFor });
  // Run against the guest's debugger; a guest that goes away mid-read fails.
  async function withPage(contents, run) {
    const done = await runWithWebContentsDebugger(contents, async (dbg) => ({
      value: await run(dbg),
    }));
    if (!done) throw new Error('The browser page closed while it was being read.');
    return done.value;
  }

  async function readPage(contents, entry, options = {}) {
    return withPage(contents, async (dbg) => {
      const render = newRender(entry, options);
      if (options.ref) {
        const target = await lookupRef(dbg, entry, options.ref);
        const tree = await axTree(dbg, target.frameId);
        const root = tree.nodes.find((node) => node.backendDOMNodeId === target.backendNodeId);
        if (!root)
          throw new Error(`${options.ref} is not on the page any more; call browser_read_page.`);
        if (await insideMaskedField(dbg, tree, root, contents.getURL()))
          throw new Error(`${options.ref} is inside a masked field.`);
        renderTree(render, tree, root, target.document, 0);
      } else {
        await renderFrames(dbg, render);
      }
      await masking.maskFields(dbg, render, contents.getURL());
      return finish(render, options.maxChars, contents);
    });
  }

  async function find(contents, entry, query) {
    return withPage(contents, async (dbg) => {
      const matches = matcher(query);
      const render = newRender(entry, {});
      await renderFrames(dbg, render);
      await masking.maskFields(dbg, render, contents.getURL());
      const hits = matches(render.lines.map((line) => line.text));
      const results = [];
      render.lines.forEach((line, index) => {
        if (results.length < MAX_FIND_RESULTS && hits[index])
          results.push([...ancestorsOf(render.lines, index), line]);
      });
      render.forget();
      const partial = render.exhausted
        ? ' (the page was too large to search to the end)'
        : render.refsCut
          ? ` (refs stop after ${MAX_REFS} elements; read one ref for more)`
          : '';
      if (results.length === 0)
        return {
          text: `No match for ${JSON.stringify(query)}${partial}.\n${footer(contents)}`,
          matches: 0,
        };
      const blocks = results.map((chain) => chain.map(indent).join('\n'));
      return {
        text: `${blocks.join('\n\n')}${partial ? `\n…${partial}` : ''}\n${footer(contents)}`,
        matches: results.length,
      };
    });
  }

  // A viewport point at the middle of the ref's element, scrolled into view,
  // and the document it was resolved in.
  async function pointForRef(contents, entry, ref) {
    return withPage(contents, async (dbg) => {
      const { backendNodeId, document } = await lookupRef(dbg, entry, ref);
      await dbg.sendCommand('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
      const { quads } = await onNode(ref, () =>
        dbg.sendCommand('DOM.getContentQuads', { backendNodeId }),
      );
      const quad = quads?.find((candidate) => quadArea(candidate) > 1);
      if (!quad) throw new Error(`${ref} has no visible box to act on.`);
      return {
        x: Math.round((quad[0] + quad[2] + quad[4] + quad[6]) / 4),
        y: Math.round((quad[1] + quad[3] + quad[5] + quad[7]) / 4),
        document,
      };
    });
  }

  // Throws when the document a target was resolved in has gone.
  async function assertDocument(contents, document) {
    await withPage(contents, async (dbg) => {
      const frames = await documentFrames(dbg);
      if (!frames.some((frame) => frame.loaderId === document))
        throw new Error('The page changed before the action ran; call browser_read_page.');
    });
  }

  // A ref inside a masked field reads as nothing, however the agent got it.
  async function insideMaskedField(dbg, tree, node, url) {
    const byId = new Map(tree.nodes.map((candidate) => [candidate.nodeId, candidate]));
    const secrets = await masking.secretsFor(url);
    for (let parent = byId.get(node.parentId); parent; parent = byId.get(parent.parentId)) {
      const field = fieldOf(parent);
      if (field && (await masking.isSensitive(dbg, field, secrets))) return true;
    }
    return false;
  }

  // Chooses an option on the ref's own <select>, wherever it lives; `before`
  // runs just before the page changes and can still stop it.
  async function selectOption(contents, entry, ref, value, before) {
    return (await callOnRef(contents, entry, ref, [value], SELECT_OPTION, before)).value;
  }

  // A CSS path to the ref's element, for page-side helpers that only reach the
  // top document; elements in frames or shadow trees are refused plainly.
  async function selectorForRef(contents, entry, ref) {
    const { value: selector, document } = await callOnRef(contents, entry, ref, [], CSS_PATH);
    if (!selector)
      throw new Error(`${ref} is inside a frame or shadow tree, which this tool cannot reach yet.`);
    return { selector, document };
  }

  async function callOnRef(contents, entry, ref, args, functionDeclaration, before) {
    return withPage(contents, async (dbg) => {
      const { backendNodeId, document } = await lookupRef(dbg, entry, ref);
      const { object } = await onNode(ref, () =>
        dbg.sendCommand('DOM.resolveNode', { backendNodeId }),
      );
      try {
        before?.();
        const { result, exceptionDetails } = await dbg.sendCommand('Runtime.callFunctionOn', {
          objectId: object.objectId,
          returnByValue: true,
          functionDeclaration,
          arguments: args.map((value) => ({ value })),
        });
        if (exceptionDetails)
          throw new Error(
            `${ref}: ${exceptionDetails.exception?.description?.split('\n')[0] ?? 'failed'}`,
          );
        return { value: result.value, document };
      } finally {
        await dbg
          .sendCommand('Runtime.releaseObject', { objectId: object.objectId })
          .catch(() => undefined);
      }
    });
  }

  // CDP calls on a node that has gone fail with protocol noise; say what happened.
  async function onNode(ref, run) {
    try {
      return await run();
    } catch (error) {
      if (/node|object/i.test(String(error?.message)))
        throw new Error(`${ref} is not on the page any more; call browser_read_page.`);
      throw error;
    }
  }

  async function lookupRef(dbg, entry, ref) {
    const known = knownRef(entry, ref);
    if (!known) throw new Error(`Unknown ref ${ref}; call browser_read_page for current refs.`);
    const frames = await documentFrames(dbg);
    const frame = frames.find((candidate) => candidate.loaderId === known.document);
    if (!frame) throw new Error(`${ref} belongs to the previous page; call browser_read_page.`);
    return { ...known, frameId: frame.id };
  }

  function newRender(entry, options) {
    return {
      entry,
      lines: [],
      fields: [],
      interactiveOnly: options.filter === 'interactive',
      processed: 0,
      refs: 0,
      exhausted: false,
      refsCut: false,
      // The least recently issued refs are forgotten once the answer is ready.
      forget: () => {
        forgetRefs(entry);
      },
    };
  }

  async function renderFrames(dbg, render) {
    const frames = await documentFrames(dbg);
    for (const frame of frames) {
      const tree = await axTree(dbg, frame.id);
      const root = tree.nodes.find((node) => !node.parentId);
      if (!root) continue;
      const nested = frame !== frames[0];
      if (nested) render.lines.push({ depth: 0, text: `- frame "${redactUrl(frame.url)}"` });
      renderTree(render, tree, root, frame.loaderId, nested ? 1 : 0);
    }
  }

  function renderTree(render, tree, root, document, baseDepth) {
    const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]));
    const { lines, interactiveOnly } = render;

    function visit(node, depth, parentName) {
      if (render.processed >= MAX_NODES) {
        render.exhausted = true;
        return;
      }
      render.processed++;
      const role = node.role?.value ?? '';
      const name = cleanName(node.name?.value);
      const skip =
        node.ignored ||
        role === 'InlineTextBox' ||
        role === 'ListMarker' ||
        (WRAPPER_ROLES.has(role) && !name) ||
        (interactiveOnly && !INTERACTIVE_ROLES.has(role));
      if (skip) {
        visitChildren(childrenOf(node), depth, parentName);
        return;
      }
      let ref;
      if (node.backendDOMNodeId && render.refs < MAX_REFS) {
        render.refs++;
        ref = refFor(render.entry, document, node.backendDOMNodeId);
      } else if (node.backendDOMNodeId) {
        render.refsCut = true;
      }
      const line = { depth, text: describe(node, role, name, ref), ref, field: fieldOf(node) };
      if (line.field) render.fields.push(line);
      const index = lines.push(line) - 1;
      if (!LEAF_ROLES.has(role))
        visitChildren(childrenOf(node), interactiveOnly ? depth : depth + 1, name);
      // A masked field hides what is inside it too, such as a select's options.
      if (line.field) line.inside = lines.slice(index + 1);
    }

    // Text, including text inside unnamed inline wrappers such as <strong>,
    // reads as one line; text that only repeats a neighbour's name is dropped.
    function visitChildren(children, depth, parentName) {
      const names = new Set([parentName]);
      for (const child of children)
        if (!TEXT_ROLES.has(child.role?.value ?? '')) names.add(cleanName(child.name?.value));
      let run = [];
      const flush = () => {
        const text = cleanText(run.join(' '));
        if (!interactiveOnly && text && !names.has(text))
          lines.push({ depth, text: `- text "${text}"` });
        run = [];
      };
      for (const child of children) {
        const counted = { nodes: 0 };
        const text = flatText(child, counted);
        if (text !== null) {
          render.processed += counted.nodes;
          if (render.processed > MAX_NODES) {
            render.exhausted = true;
            break;
          }
          run.push(text);
          continue;
        }
        flush();
        visit(child, depth, parentName);
      }
      flush();
    }

    // The text of a text node or of an unnamed wrapper holding only text; null
    // for anything with structure of its own.
    // Gives up (null) once the node budget would run out, so the nodes are
    // visited one by one and the read stops at the limit.
    function flatText(node, counted) {
      if (render.processed + ++counted.nodes > MAX_NODES) return null;
      const role = node.role?.value ?? '';
      if (TEXT_ROLES.has(role) && !node.ignored) return node.name?.value ?? '';
      const wrapper = node.ignored || (WRAPPER_ROLES.has(role) && !cleanName(node.name?.value));
      if (!wrapper) return null;
      const parts = childrenOf(node).map((child) => flatText(child, counted));
      return parts.some((part) => part === null) ? null : parts.join(' ');
    }

    function childrenOf(node) {
      return (node.childIds ?? []).map((id) => byId.get(id)).filter(Boolean);
    }

    visit(root, baseDepth, '');
  }

  function describe(node, role, name, ref) {
    let text = `- ${role}${name ? ` "${name}"` : ''}`;
    if (ref) text += ` [ref=${ref}]`;
    for (const property of node.properties ?? []) {
      const value = property.value?.value;
      if (property.name === 'level' && role === 'heading') text += ` [level=${value}]`;
      else if (STATE_PROPERTIES.includes(property.name) && value && value !== 'false')
        text +=
          value === true || value === 'true'
            ? ` [${property.name}]`
            : ` [${property.name}=${value}]`;
    }
    return text;
  }

  function finish(render, maxChars = DEFAULT_MAX_CHARS, contents) {
    render.forget();
    const limit = Math.max(500, Math.min(Number(maxChars) || DEFAULT_MAX_CHARS, 100_000));
    let body = render.lines.map(indent).join('\n');
    const notes = [];
    if (body.length > limit) {
      const lastLine = body.lastIndexOf('\n', limit);
      body = body.slice(0, lastLine > 0 ? lastLine : limit);
      notes.push(
        `cut at ${limit} characters; read one ref, raise max_chars, or use filter "interactive"`,
      );
    }
    if (render.exhausted) notes.push(`stopped after ${MAX_NODES} elements`);
    if (render.refsCut) notes.push(`refs stop after ${MAX_REFS} elements; read one ref for more`);
    if (notes.length) body += `\n… (${notes.join('; ')})`;
    return `${body || '(The page has no readable content.)'}\n${footer(contents)}`;
  }

  function footer(contents) {
    return `[${cleanName(contents.getTitle()) || 'Untitled'} · ${redactUrl(contents.getURL())}]`;
  }

  return { readPage, find, pointForRef, assertDocument, selectOption, selectorForRef };
}

// Run inside the page on the ref's own element.
const SELECT_OPTION = `function (wanted) {
  if (this.localName !== 'select') throw new Error('not a select element');
  const options = [...this.options];
  const option =
    options.find((candidate) => candidate.value === wanted) ??
    options.find((candidate) => candidate.label.trim() === wanted || candidate.text.trim() === wanted);
  if (!option) throw new Error('no option "' + wanted + '"');
  this.value = option.value;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return option.value;
}`;
const CSS_PATH = `function () {
  if (window !== window.top || !(this.getRootNode() instanceof Document)) return null;
  const parts = [];
  for (let el = this; el && el !== document.documentElement; el = el.parentElement) {
    let index = 1;
    for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
    parts.unshift(el.localName + ':nth-child(' + index + ')');
  }
  return ['html', ...parts].join(' > ');
}`;

async function documentFrames(dbg) {
  const { frameTree } = await dbg.sendCommand('Page.getFrameTree');
  const frames = [];
  const walk = (tree) => {
    frames.push(tree.frame);
    for (const child of tree.childFrames ?? []) walk(child);
  };
  walk(frameTree);
  return frames;
}

function axTree(dbg, frameId) {
  return dbg.sendCommand('Accessibility.getFullAXTree', { frameId });
}

function ancestorsOf(lines, index) {
  const chain = [];
  let depth = lines[index].depth;
  for (let i = index - 1; i >= 0 && depth > 0; i--) {
    if (lines[i].depth < depth) {
      chain.unshift(lines[i]);
      depth = lines[i].depth;
    }
  }
  return chain;
}

// Which lines match plain text, or a /regex/flags. An agent's pattern runs on
// the main thread, so it runs under a time limit; flags that make a regex
// stateful are dropped.
function matcher(query) {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(String(query));
  if (!regex) {
    const needle = String(query).toLowerCase();
    return (texts) => texts.map((text) => text.toLowerCase().includes(needle));
  }
  const pattern = new RegExp(regex[1], regex[2].replace(/[gy]/g, ''));
  return (texts) => {
    try {
      return vm.runInNewContext(
        'texts.map((text) => pattern.test(text))',
        { texts, pattern },
        {
          timeout: REGEX_TIME_LIMIT_MS,
        },
      );
    } catch {
      throw new Error('That /regex/ took too long; search for plain text or a simpler pattern.');
    }
  };
}

// Shoelace area, so a rotated element still counts as visible.
function quadArea(quad) {
  let twice = 0;
  for (let i = 0; i < 8; i += 2) {
    const next = (i + 2) % 8;
    twice += quad[i] * quad[next + 1] - quad[next] * quad[i + 1];
  }
  return Math.abs(twice) / 2;
}

function indent(line) {
  return `${'  '.repeat(line.depth)}${line.text}`;
}

function cleanName(value) {
  const text = cleanText(value);
  return text.length > MAX_NAME_CHARS ? `${text.slice(0, MAX_NAME_CHARS)}…` : text;
}

module.exports = { createBrowserReading };
