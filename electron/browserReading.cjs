// What agents read from a page: Chromium's accessibility tree, compacted into
// short lines such as `- button "Sign in" [ref=e3]`. A ref names one DOM node
// in one document and is never reused; a ref from a document that has since
// gone fails plainly instead of acting on something else.

const MAX_NODES = 20_000;
const MAX_REFS = 1_000;
const MAX_REMEMBERED_REFS = 10_000;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_FIND_RESULTS = 20;

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
const TEXT_ROLES = new Set(['StaticText', 'text']);
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
// Fields whose inside only repeats their value.
const LEAF_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'slider']);
const STATE_PROPERTIES = ['checked', 'pressed', 'selected', 'expanded', 'disabled', 'required'];

function createBrowserReading({ runWithWebContentsDebugger, isSensitiveName, redactUrl }) {
  // Lives on the browser session's entry: refs outlive guests and documents so
  // an old one can be recognised, but ids are never handed out twice.
  function registryFor(entry) {
    entry.refs ??= { next: 1, byNode: new Map(), byRef: new Map() };
    return entry.refs;
  }

  function refFor(registry, document, backendNodeId) {
    const key = `${document}:${backendNodeId}`;
    let ref = registry.byNode.get(key);
    if (!ref) {
      ref = `e${registry.next++}`;
      registry.byNode.set(key, ref);
      registry.byRef.set(ref, { document, backendNodeId });
      if (registry.byRef.size > MAX_REMEMBERED_REFS) forgetOldest(registry);
    }
    return ref;
  }

  async function readPage(contents, entry, options = {}) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const frames = await documentFrames(dbg);
      const registry = registryFor(entry);
      const lines = [];
      let root;
      if (options.ref) {
        const target = await lookupRef(dbg, entry, options.ref);
        const tree = await axTree(dbg, target.frameId);
        root = tree.nodes.find((node) => node.backendDOMNodeId === target.backendNodeId);
        if (!root)
          throw new Error(`${options.ref} is not on the page any more; call browser_read_page.`);
        renderTree(tree, root, target.document, registry, options, lines);
      } else {
        for (const frame of frames) {
          const tree = await axTree(dbg, frame.id);
          root = tree.nodes.find((node) => !node.parentId);
          if (!root) continue;
          if (frame !== frames[0])
            lines.push({ depth: 0, text: `- frame "${redactUrl(frame.url)}"` });
          renderTree(
            tree,
            root,
            frame.loaderId,
            registry,
            options,
            lines,
            frame === frames[0] ? 0 : 1,
          );
        }
      }
      return finish(lines, options.maxChars, contents);
    });
  }

  async function find(contents, entry, query) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const matches = matcher(query);
      const registry = registryFor(entry);
      const results = [];
      for (const frame of await documentFrames(dbg)) {
        const tree = await axTree(dbg, frame.id);
        const root = tree.nodes.find((node) => !node.parentId);
        if (!root) continue;
        const lines = [];
        renderTree(tree, root, frame.loaderId, registry, {}, lines);
        lines.forEach((line, index) => {
          if (results.length >= MAX_FIND_RESULTS || !matches(line.text)) return;
          results.push([...ancestorsOf(lines, index), line]);
        });
      }
      if (results.length === 0)
        return { text: `No match for ${JSON.stringify(query)}.\n${footer(contents)}`, matches: 0 };
      const blocks = results.map((chain) => chain.map(indent).join('\n'));
      return { text: `${blocks.join('\n\n')}\n${footer(contents)}`, matches: results.length };
    });
  }

  // A viewport point at the middle of the ref's element, scrolled into view.
  async function pointForRef(contents, entry, ref) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const { backendNodeId } = await lookupRef(dbg, entry, ref);
      await dbg.sendCommand('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
      const { quads } = await onNode(ref, () =>
        dbg.sendCommand('DOM.getContentQuads', { backendNodeId }),
      );
      const quad = quads?.find((candidate) => quadArea(candidate) > 1);
      if (!quad) throw new Error(`${ref} has no visible box to act on.`);
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      return {
        x: Math.round(xs.reduce((sum, value) => sum + value, 0) / 4),
        y: Math.round(ys.reduce((sum, value) => sum + value, 0) / 4),
      };
    });
  }

  // A CSS path to the ref's element in its own document, for page-side helpers.
  async function selectorForRef(contents, entry, ref) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const { backendNodeId } = await lookupRef(dbg, entry, ref);
      const { object } = await onNode(ref, () =>
        dbg.sendCommand('DOM.resolveNode', { backendNodeId }),
      );
      const { result } = await dbg.sendCommand('Runtime.callFunctionOn', {
        objectId: object.objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          const parts = [];
          for (let el = this; el && el.nodeType === 1 && el !== el.ownerDocument.documentElement; el = el.parentElement) {
            let index = 1;
            for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
            parts.unshift(el.localName + ':nth-child(' + index + ')');
          }
          return ['html', ...parts].join(' > ');
        }`,
      });
      await dbg
        .sendCommand('Runtime.releaseObject', { objectId: object.objectId })
        .catch(() => undefined);
      return result.value;
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
    const known = registryFor(entry).byRef.get(ref);
    if (!known) throw new Error(`Unknown ref ${ref}; call browser_read_page for current refs.`);
    const frames = await documentFrames(dbg);
    const frame = frames.find((candidate) => candidate.loaderId === known.document);
    if (!frame) throw new Error(`${ref} belongs to the previous page; call browser_read_page.`);
    return { ...known, frameId: frame.id };
  }

  function renderTree(tree, root, document, registry, options, lines, baseDepth = 0) {
    const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]));
    const interactiveOnly = options.filter === 'interactive';
    let processed = 0;
    let refs = 0;

    function visit(node, depth, parentName) {
      if (!node || processed >= MAX_NODES) return;
      processed++;
      const role = node.role?.value ?? '';
      const name = clean(node.name?.value);
      const children = childrenOf(node);
      const skip =
        node.ignored ||
        role === 'InlineTextBox' ||
        role === 'ListMarker' ||
        (WRAPPER_ROLES.has(role) && !name) ||
        (interactiveOnly && !INTERACTIVE_ROLES.has(role));
      if (skip) {
        visitChildren(children, depth, parentName);
        return;
      }
      const ref =
        node.backendDOMNodeId && refs < MAX_REFS
          ? (refs++, refFor(registry, document, node.backendDOMNodeId))
          : undefined;
      lines.push({ depth, text: describe(node, role, name, ref) });
      if (!LEAF_ROLES.has(role)) visitChildren(children, interactiveOnly ? depth : depth + 1, name);
    }

    // Text, including text inside unnamed inline wrappers such as <strong>,
    // reads as one line; text that only repeats a neighbour's name is dropped.
    function visitChildren(children, depth, parentName) {
      const names = new Set([parentName]);
      for (const child of children) names.add(clean(child.name?.value));
      let run = [];
      const flush = () => {
        const text = clean(run.join(' '));
        if (!interactiveOnly && text && !names.has(text))
          lines.push({ depth, text: `- text "${text}"` });
        run = [];
      };
      for (const child of children) {
        const text = flatText(child);
        if (text !== null) {
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
    function flatText(node) {
      const role = node.role?.value ?? '';
      if (TEXT_ROLES.has(role) && !node.ignored) {
        processed++;
        return node.name?.value ?? '';
      }
      const wrapper = node.ignored || (WRAPPER_ROLES.has(role) && !clean(node.name?.value));
      if (!wrapper) return null;
      const parts = childrenOf(node).map(flatText);
      if (parts.some((part) => part === null)) return null;
      processed++;
      return parts.join(' ');
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
    const value = clean(node.value?.value);
    if (VALUE_ROLES.has(role) && value) text += `: ${isSensitiveName(name) ? '••••' : value}`;
    return text;
  }

  function finish(lines, maxChars = DEFAULT_MAX_CHARS, contents) {
    const limit = Math.max(500, Math.min(Number(maxChars) || DEFAULT_MAX_CHARS, 100_000));
    let body = lines.map(indent).join('\n');
    if (body.length > limit) {
      body = `${body.slice(0, body.lastIndexOf('\n', limit))}\n… (cut at ${limit} characters; read one ref, or use filter "interactive")`;
    }
    return `${body || '(The page has no readable content.)'}\n${footer(contents)}`;
  }

  function footer(contents) {
    return `[${clean(contents.getTitle()) || 'Untitled'} · ${redactUrl(contents.getURL())}]`;
  }

  return { readPage, find, pointForRef, selectorForRef };
}

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

function matcher(query) {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(String(query));
  if (regex) {
    const pattern = new RegExp(regex[1], regex[2]);
    return (text) => pattern.test(text);
  }
  const needle = String(query).toLowerCase();
  return (text) => text.toLowerCase().includes(needle);
}

function forgetOldest(registry) {
  const drop = [...registry.byRef.keys()].slice(0, MAX_REMEMBERED_REFS / 5);
  for (const ref of drop) {
    const { document, backendNodeId } = registry.byRef.get(ref);
    registry.byRef.delete(ref);
    registry.byNode.delete(`${document}:${backendNodeId}`);
  }
}

function quadArea(quad) {
  return Math.abs((quad[2] - quad[0]) * (quad[5] - quad[1]));
}

function indent(line) {
  return `${'  '.repeat(line.depth)}${line.text}`;
}

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

module.exports = { createBrowserReading };
