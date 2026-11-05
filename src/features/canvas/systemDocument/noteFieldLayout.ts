// The editor of a note set out as the note renders (Markdown.tsx), so the text
// keeps its place when a click turns one into the other. Rendered blocks sit a
// gap apart whether or not a blank line separates them in the markdown, and
// list items a smaller step apart, blank line or not. A list item's lines sit
// at its depth's indent, and a bullet item shows the rendered bullet in place
// of its `- `. The indentation of a paragraph's later lines is hidden, as the
// rendered note drops it. A blank line in a list shows as nothing, as the
// rendered list ignores it, until an edit leaves the caret on it. The caret
// stays off what is hidden, so typing never lands in front of an item's
// marker, and a step passes blank lines by, as the rendered note has no line
// there. Backspace at the start of a line's text removes what shows before it:
// an item's bullet or number first, then the line break.
// designSystemDocument.css sizes what these classes mark.

import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  Prec,
  StateField,
  type Line,
  type Range,
  type SelectionRange,
  type Text,
} from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';

const blockStart = Decoration.line({ class: 'kit-note-block' });
const itemStart = Decoration.line({ class: 'kit-note-item' });
const blankInList = Decoration.line({ class: 'kit-note-blank' });
const blankWithCaret = Decoration.line({ class: 'kit-note-blank-open' });
const hidden = Decoration.replace({});

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode'];

/** A list item's marker line, or a later line of a paragraph or item. */
interface TextLine {
  kind: 'marker' | 'continued';
  textFrom: number;
}

interface Layout {
  all: DecorationSet;
  hidden: DecorationSet;
  /** The lines whose text can start after what is hidden, by where each line starts. */
  textLines: Map<number, TextLine>;
  /** Where each blank line in a list starts. */
  blankLines: Set<number>;
}

function isBlank(line: Line): boolean {
  return line.text.trim() === '';
}

function followsText(doc: Text, at: number): boolean {
  const line = doc.lineAt(at);
  return line.number > 1 && !isBlank(doc.line(line.number - 1));
}

function isList(node: SyntaxNode): boolean {
  return node.name === 'BulletList' || node.name === 'OrderedList';
}

// A list nested in an item, and every item after the first, step down a little.
function isListStep(node: SyntaxNode): boolean {
  if (node.name === 'ListItem') return node.prevSibling?.name === 'ListItem';
  return isList(node) && node.parent?.name === 'ListItem';
}

function itemDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let at = node.parent; at; at = at.parent) if (at.name === 'ListItem') depth += 1;
  return depth;
}

// A bullet line hangs the rendered bullet; any other line of an item, its
// number or its text, starts at the item's text.
function itemLine(kind: 'bullet' | 'indent', depth: number) {
  return Decoration.line({
    class: kind === 'bullet' ? 'kit-note-bullet' : 'kit-note-indent',
    attributes: { style: `--note-depth: ${String(depth)}` },
  });
}

function layoutOf(state: EditorState): Layout {
  const { doc } = state;
  const lines: Range<Decoration>[] = [];
  const folds: Range<Decoration>[] = [];
  const textLines = new Map<number, TextLine>();
  const blankDepths = new Map<number, number>();

  // A blank line belongs to the innermost list or item around it, which is
  // entered last.
  function noteBlankLines(node: SyntaxNode) {
    for (let at = doc.lineAt(node.from).number; at <= doc.lineAt(node.to).number; at++) {
      const blank = doc.line(at);
      if (isBlank(blank)) blankDepths.set(blank.from, itemDepth(node) + 1);
    }
  }

  function layOutMarkerLine(mark: SyntaxNode) {
    const line = doc.lineAt(mark.from);
    const isBullet = mark.parent?.parent?.name === 'BulletList';
    const textFrom = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to;
    lines.push(itemLine(isBullet ? 'bullet' : 'indent', itemDepth(mark)).range(line.from));
    if (isBullet || line.from < mark.from)
      folds.push(hidden.range(line.from, isBullet ? textFrom : mark.from));
    textLines.set(line.from, { kind: 'marker', textFrom });
  }

  // The later lines of a paragraph, and of an item a paragraph after a blank
  // line too.
  function layOutLaterLines(paragraph: SyntaxNode) {
    const parent = paragraph.parent;
    const inItem = parent?.name === 'ListItem';
    if (!inItem && parent?.name !== 'Document') return;
    const firstLine = doc.lineAt(inItem ? parent.from : paragraph.from).number;
    for (let at = doc.lineAt(paragraph.from).number; at <= doc.lineAt(paragraph.to).number; at++) {
      if (at === firstLine) continue;
      const text = doc.line(at);
      const textFrom = text.from + (/^\s*/.exec(text.text)?.[0].length ?? 0);
      if (inItem) lines.push(itemLine('indent', itemDepth(paragraph)).range(text.from));
      if (textFrom > text.from) folds.push(hidden.range(text.from, textFrom));
      textLines.set(text.from, { kind: 'continued', textFrom });
    }
  }

  syntaxTree(state).iterate({
    enter({ node }) {
      const lineFrom = doc.lineAt(node.from).from;
      if (node.parent?.name === 'Document' && followsText(doc, node.from))
        lines.push(blockStart.range(lineFrom));
      if (isListStep(node)) lines.push(itemStart.range(lineFrom));
      if (isList(node) || node.name === 'ListItem') noteBlankLines(node);
      if (node.name === 'ListMark') layOutMarkerLine(node);
      if (node.name === 'Paragraph') layOutLaterLines(node);
      if (node.name === 'HardBreak' && doc.sliceString(node.from, node.from + 1) === '\\')
        folds.push(hidden.range(node.from, node.from + 1));
    },
  });
  // The rendered list ignores its blank lines; its steps are the items'. One
  // holding the caret is an empty line of its item.
  for (const [from, depth] of blankDepths) {
    const blank = doc.lineAt(from);
    lines.push(blankInList.range(from), itemLine('indent', depth).range(from));
    if (blank.length > 0) folds.push(hidden.range(from, blank.to));
    textLines.set(from, { kind: 'continued', textFrom: blank.to });
  }
  return {
    all: Decoration.set([...lines, ...folds], true),
    hidden: Decoration.set(folds, true),
    textLines,
    blankLines: new Set(blankDepths.keys()),
  };
}

// Folded ranges are atomic: arrow keys step over them and Backspace removes
// them whole.
const layoutField = StateField.define<Layout>({
  create: layoutOf,
  update(layout, transaction) {
    // The parser can finish after the change that started it.
    const reparsed = syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    return transaction.docChanged || reparsed ? layoutOf(transaction.state) : layout;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (layout) => layout.all),
    EditorView.decorations.compute([field, 'selection'], (state) => {
      const line = state.doc.lineAt(state.selection.main.head);
      if (!state.field(field).blankLines.has(line.from)) return Decoration.none;
      return Decoration.set(blankWithCaret.range(line.from));
    }),
    EditorView.atomicRanges.of((view) => view.state.field(field).hidden),
  ],
});

// Where a step onto a blank line lands instead: the next line of text that way,
// its start going forward and its end going back.
function pastBlankLines(doc: Text, head: number, forward: boolean): number {
  let line = doc.lineAt(head);
  while (isBlank(line)) {
    const next = line.number + (forward ? 1 : -1);
    if (next < 1 || next > doc.lines) return head;
    line = doc.line(next);
    head = forward ? line.from : line.to;
  }
  return head;
}

// The caret lands on text the note shows. A caret before a line's text, where
// a click in the indent, Home or a step down puts it, moves onto the
// text, and one moved onto a blank line passes it by. A blank line an edit
// leaves keeps the caret.
const caretOnShownText = EditorState.transactionFilter.of((transaction) => {
  const caret = transaction.selection?.main;
  if (!caret?.empty) return transaction;
  const doc = transaction.newDoc;
  const { textLines } = transaction.state.field(layoutField);
  let head = caret.head;
  if (!transaction.docChanged) {
    const forward = head >= transaction.startState.selection.main.head;
    head = pastBlankLines(doc, head, forward);
  }
  const line = textLines.get(doc.lineAt(head).from);
  if (line && head < line.textFrom) head = line.textFrom;
  if (head === caret.head) return transaction;
  return [transaction, { selection: EditorSelection.cursor(head), sequential: true }];
});

// A step up or down keeps its column past blank lines, as it would between the
// rendered lines; the browser's own step stops on them.
function stepLine(forward: boolean) {
  return (view: EditorView): boolean => {
    const caret = view.state.selection.main;
    if (!caret.empty) return false;
    const onBlank = (range: SelectionRange) => isBlank(view.state.doc.lineAt(range.head));
    let next = view.moveVertically(caret, forward);
    while (onBlank(next)) {
      const further = view.moveVertically(next, forward);
      if (further.head === next.head) break;
      next = further;
    }
    // On the first or last row the browser's step goes to the end of the text.
    if (next.head === caret.head) return false;
    view.dispatch({
      selection: EditorSelection.create([next]),
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  };
}

// The line whose text the caret starts, with the line of text above it:
// blank lines in a list show as nothing, so the caret passes them by.
function lineTextAtCaret(state: EditorState) {
  const caret = state.selection.main;
  const line = state.doc.lineAt(caret.head);
  const textLine = state.field(layoutField).textLines.get(line.from);
  if (!caret.empty || caret.head !== textLine?.textFrom || line.number === 1) return null;
  let above = state.doc.line(line.number - 1);
  while (above.number > 1 && isBlank(above)) above = state.doc.line(above.number - 1);
  return { textLine, above };
}

// Stepping back from a line's text goes to the end of the line above, as it
// would from the rendered line, instead of into what is hidden.
function stepBackFromLineText(view: EditorView): boolean {
  const at = lineTextAtCaret(view.state);
  if (!at) return false;
  view.dispatch({ selection: { anchor: at.above.to }, userEvent: 'select' });
  return true;
}

// Backspace at the start of a later line joins it to the text above, blank
// lines and hidden indentation included, in one visible step. On an item's
// marker line markdown's Backspace goes first and turns the marker into
// indentation, so the text stays put as the next line of the item above, or
// as a line of its own when no item is above.
function joinLine(view: EditorView): boolean {
  const at = lineTextAtCaret(view.state);
  if (at?.textLine.kind !== 'continued') return false;
  view.dispatch({
    changes: { from: at.above.to, to: at.textLine.textFrom },
    selection: { anchor: at.above.to },
    userEvent: 'delete.backward',
  });
  return true;
}

export const noteFieldLayout = [
  layoutField,
  caretOnShownText,
  // Ahead of markdown's Backspace, which would unwind the indentation alone.
  Prec.highest(
    keymap.of([
      { key: 'ArrowLeft', run: stepBackFromLineText },
      { key: 'ArrowUp', run: stepLine(false) },
      { key: 'ArrowDown', run: stepLine(true) },
      { key: 'Backspace', run: joinLine },
    ]),
  ),
];
