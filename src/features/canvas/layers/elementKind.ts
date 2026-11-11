// What kind of layer an outline row is, as its icon and its accessible name
// say: a container, text, an image, a vector, a control, a break, an instance,
// a repeat or a condition.

import {
  Component,
  GitBranch,
  LayoutTemplate,
  Minus,
  Picture,
  Repeat,
  SlidersHorizontal,
  Type,
  Vector,
  type IconComponent,
} from '@droidex/icons';
import type { OutlineNode } from '../protocol';

type LayerKind =
  | 'container'
  | 'text'
  | 'image'
  | 'vector'
  | 'control'
  | 'break'
  | 'instance'
  | 'repeat'
  | 'condition';

const KINDS: Record<LayerKind, { icon: IconComponent; label: string }> = {
  container: { icon: LayoutTemplate, label: 'Container' },
  text: { icon: Type, label: 'Text' },
  image: { icon: Picture, label: 'Image' },
  vector: { icon: Vector, label: 'Vector' },
  control: { icon: SlidersHorizontal, label: 'Control' },
  break: { icon: Minus, label: 'Break' },
  instance: { icon: Component, label: 'Instance' },
  repeat: { icon: Repeat, label: 'Repeat' },
  condition: { icon: GitBranch, label: 'Condition' },
};

const IMAGE_TAGS = new Set(['img', 'picture', 'video']);
const VECTOR_TAGS = new Set([
  'svg',
  'path',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'rect',
]);
const CONTROL_TAGS = new Set(['input', 'textarea', 'select', 'button']);
const BREAK_TAGS = new Set(['hr', 'br', 'wbr']);

/** A row's kind: the icon it shows and the name a screen reader hears after its label. */
export function layerKind(node: OutlineNode): { icon: IconComponent; label: string } {
  return KINDS[kindOf(node)];
}

function kindOf(node: OutlineNode): LayerKind {
  if (node.kind !== 'element') return node.kind;
  if (IMAGE_TAGS.has(node.name)) return 'image';
  if (VECTOR_TAGS.has(node.name)) return 'vector';
  if (CONTROL_TAGS.has(node.name)) return 'control';
  if (BREAK_TAGS.has(node.name)) return 'break';
  return node.text === null ? 'container' : 'text';
}
