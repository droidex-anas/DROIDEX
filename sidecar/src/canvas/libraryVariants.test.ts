import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { moduleElements, variantTables } from './libraryVariants.js';

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
`;

test('a literal cva reads as enum props, its booleans left out', () => {
  assert.deepEqual(variantTables(parsed(BUTTON)), [
    {
      name: 'buttonVariants',
      props: [
        { name: 'variant', options: ['default', 'outline', 'icon-sm'], default: 'default' },
        { name: 'size', options: ['default', 'sm'], default: 'sm' },
        { name: 'tone', options: ['quiet', 'loud'], default: null },
      ],
    },
  ]);
});

test('a cva with any variant or default written in code reads as none', () => {
  const written = [
    BUTTON.replace('variants: {', 'variants: { ...shared,'),
    BUTTON.replace('sm: "h-8"', 'sm: small'),
    BUTTON.replace('sm: "h-8"', '[small]: "h-8"'),
    BUTTON.replace('size: "sm", inset', 'size: preferred, inset'),
    BUTTON.replace('variants: {\n', 'variants: theme.variants, unused: {\n'),
    BUTTON.replace('const buttonVariants', 'let buttonVariants'),
    BUTTON.replace('"class-variance-authority"', '"./cva"'),
  ];
  for (const source of written) assert.deepEqual(variantTables(parsed(source)), [], source);
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
