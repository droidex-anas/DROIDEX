import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { componentVariants, moduleElements } from './libraryVariants.js';

function parsed(source: string): ts.SourceFile {
  return ts.createSourceFile(
    'button.tsx',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
}

const BUTTON = `import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva("inline-flex", {
  variants: {
    variant: { default: "bg-primary", outline: ["border", "bg-background"], "icon-sm": "size-8" },
    size: { default: "h-9", sm: "h-8" },
    inset: { true: "pl-8", false: "" },
    tone: { quiet: "opacity-80", loud: "font-bold" },
  },
  compoundVariants: [{ variant: "outline", size: "sm", className: someClass }],
  defaultVariants: { variant: "default", size: "sm", inset: false },
});

export function Button() {
  return <button className={buttonVariants()} />;
}
`;

test('a literal cva reads as enum props of the component that uses it, its booleans left out', () => {
  assert.deepEqual(componentVariants(parsed(BUTTON)), [
    {
      component: 'Button',
      props: [
        { name: 'variant', options: ['default', 'outline', 'icon-sm'], default: 'default' },
        { name: 'size', options: ['default', 'sm'], default: 'sm' },
        { name: 'tone', options: ['quiet', 'loud'], default: null },
      ],
    },
  ]);
});

test('a cva with any variant or default written in code, or cva imported as a type, reads as none', () => {
  const written = [
    BUTTON.replace('variants: {', 'variants: { ...shared,'),
    BUTTON.replace('sm: "h-8"', 'sm: small'),
    BUTTON.replace('sm: "h-8"', '[small]: "h-8"'),
    BUTTON.replace('size: "sm", inset', 'size: preferred, inset'),
    BUTTON.replace('variants: {\n', 'variants: theme.variants, unused: {\n'),
    BUTTON.replace('const buttonVariants', 'let buttonVariants'),
    BUTTON.replace('"class-variance-authority"', '"./cva"'),
    BUTTON.replace('import { cva, type VariantProps }', 'import type { cva, VariantProps }'),
  ];
  for (const source of written) assert.deepEqual(componentVariants(parsed(source)), [], source);
});

test('a component takes the variants of the one literal table its own declaration uses, by the name it is exported as', () => {
  const source = `${BUTTON.replace('export function Button', 'function Base')}
const linkVariants = cva("underline", { variants: { tone: { muted: "a", loud: "b" } } });
const Link = forwardRef(() => <a className={linkVariants()} />);
export function Both() {
  return buttonVariants() + linkVariants();
}
export function Neither(props) {
  return props.buttonVariants;
}
export { Base as Button };
export default Link;
`;
  assert.deepEqual(
    componentVariants(parsed(source)).map(({ component, props }) => [
      component,
      props.map(({ name }) => name),
    ]),
    [
      ['Button', ['variant', 'size', 'tone']],
      ['default', ['tone']],
    ],
  );
});

test("an element's quoted attributes read as text and any other value as null", () => {
  const source =
    '<div><Button variant="outline" size={size} disabled {...rest}>Go</Button><Icon /></div>';
  assert.deepEqual(moduleElements(parsed(source)), [
    {
      tag: 'Button',
      attributes: [
        { name: 'variant', value: 'outline' },
        { name: 'size', value: null },
        { name: 'disabled', value: null },
      ],
      spreads: true,
    },
    { tag: 'Icon', attributes: [], spreads: false },
  ]);
});
