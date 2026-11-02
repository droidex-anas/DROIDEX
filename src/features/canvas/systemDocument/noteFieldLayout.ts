// The editor of a note set out as the note renders (Markdown.tsx), so the text
// keeps its place when a click turns one into the other. Rendered blocks sit a
// gap apart whether or not a blank line separates them in the markdown, list
// items a smaller step apart, and a bullet item shows the rendered bullet in
// place of its `- `, which the caret steps over and Backspace removes whole.
// Inline code naming a file is marked as the rendered note marks it.
// designSystemDocument.css sizes what these classes mark.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range, Text } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { repoPathInProse } from '../../../lib/prosePaths';

const blockStart = Decoration.line({ class: 'kit-note-block' });
const itemStart = Decoration.line({ class: 'kit-note-item' });
const bulletLine = Decoration.line({ class: 'kit-note-bullet' });
const hiddenDash = Decoration.replace({});
const filePath = Decoration.mark({ attributes: { 'data-file-path': '' } });

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

interface Layout {
  all: DecorationSet;
  dashes: DecorationSet;
}

function followsText(doc: Text, at: number): boolean {
  const line = doc.lineAt(at);
  return line.number > 1 && doc.line(line.number - 1).text.trim() !== '';
}

// A list nested in an item, and every item after the first, step down a little.
function isListStep(node: SyntaxNode): boolean {
  if (node.name === 'ListItem') return node.prevSibling?.name === 'ListItem';
  return /^(?:Bullet|Ordered)List$/.test(node.name) && node.parent?.name === 'ListItem';
}

function isFilePath(doc: Text, node: SyntaxNode): boolean {
  if (node.name !== 'InlineCode') return false;
  return repoPathInProse(doc.sliceString(node.from, node.to).replace(/^`+|`+$/g, '')) !== null;
}

function layoutOf(state: EditorState): Layout {
  const { doc } = state;
  const lines: Range<Decoration>[] = [];
  const dashes: Range<Decoration>[] = [];
  const paths: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter({ node }) {
      const parent = node.parent;
      const lineStart = doc.lineAt(node.from).from;
      if (parent?.name === 'Document' && followsText(doc, node.from))
        lines.push(blockStart.range(lineStart));
      if (isListStep(node) && followsText(doc, node.from)) lines.push(itemStart.range(lineStart));
      if (node.name === 'ListMark' && parent?.parent?.name === 'BulletList') {
        const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
        lines.push(bulletLine.range(lineStart));
        dashes.push(hiddenDash.range(node.from, end));
      }
      if (isFilePath(doc, node)) paths.push(filePath.range(node.from, node.to));
    },
  });
  return {
    all: Decoration.set([...lines, ...dashes, ...paths], true),
    dashes: Decoration.set(dashes, true),
  };
}

const layoutPlugin = ViewPlugin.fromClass(
  class {
    layout: Layout;

    constructor(view: EditorView) {
      this.layout = layoutOf(view.state);
    }

    update(update: ViewUpdate) {
      // The parser can finish after the change that started it.
      if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state))
        this.layout = layoutOf(update.state);
    }
  },
  { decorations: (plugin) => plugin.layout.all },
);

export const noteFieldLayout = [
  layoutPlugin,
  EditorView.atomicRanges.of((view) => view.plugin(layoutPlugin)?.layout.dashes ?? Decoration.none),
];
