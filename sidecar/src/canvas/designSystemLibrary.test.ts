import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, type TestContext } from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { ownedCanvasRuntimeDir, startCanvasRuntime, stopCanvasRuntime } from './canvasRuntime.js';
import { kitPrimitives } from './designSystemBrief.js';
import { MAX_LIBRARY_COMPONENTS, TAILWIND_4_REFUSAL } from './designSystemLibrary.js';
import { importProjectDesignSystem } from './designSystemProject.js';
import { buildDesignStylesheet } from './designStylesheet.js';
import { KitPreviews } from './kitPreviews.js';

pinScratchProfile();
after(() => stopCanvasRuntime());

const KIT = { id: 'acme', name: 'Acme' };
const SHADCN = [{ path: 'components.json', kind: 'shadcn' as const }];

const COMPONENTS_JSON = {
  $schema: 'https://ui.shadcn.com/schema.json',
  style: 'new-york',
  rsc: true,
  tsx: true,
  tailwind: {
    config: 'tailwind.config.ts',
    css: 'app/globals.css',
    baseColor: 'neutral',
    cssVariables: true,
    prefix: '',
  },
  aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components/ui' },
  iconLibrary: 'lucide',
};

// A Tailwind 3 shadcn/ui project as `shadcn init` and `shadcn add` leave it.
const LIBRARY: Record<string, string> = {
  'components.json': JSON.stringify(COMPONENTS_JSON, null, 2),
  'tsconfig.json': `{
  // Next.js writes comments and trailing commas here.
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./*"], },
  },
}`,
  'tailwind.config.ts': `import type { Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";

const config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: { sans: ["var(--font-geist-sans)", ...fontFamily.sans] },
      keyframes: { "accordion-down": { from: { height: "0" }, to: { height: "1px" } } },
      animation: { "accordion-down": "accordion-down 0.2s ease-out" },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
`,
  'app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --ring: 0 0% 3.9%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 0 0% 9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`,
  'lib/utils.ts': `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`,
  'components/ui/button.tsx': `import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        outline: "border bg-background shadow-sm",
      },
      size: { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
`,
  'components/ui/card.tsx': `import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
}

export { Card, CardTitle }
`,
  'components/ui/dialog.tsx': `"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const Dialog = DialogPrimitive.Root

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content
        className={cn("fixed left-1/2 top-1/2 grid gap-4 border bg-background p-6 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:rounded-lg", className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className={buttonVariants({ variant: "outline", size: "sm" })}>
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export { Dialog, DialogContent }
`,
  'components/ui/sonner.tsx': `"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

export function Toaster() {
  const { theme } = useTheme()
  return <Sonner theme={theme as "light" | "dark"} />
}
`,
  'components/ui/notice.tsx': `import { Toaster } from "@/components/ui/sonner"

export function Notice() {
  return <Toaster />
}
`,
};

async function project(t: TestContext, files: Record<string, string>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'kit-library-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'acme-web');
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}

test('a shadcn/ui library becomes a kit of its own components, tokens and theme that builds', async (t) => {
  const imported = await importProjectDesignSystem(await project(t, LIBRARY), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const { system, diagnostics } = imported;
  assert.deepEqual(kitPrimitives(system), [
    'Button',
    'buttonVariants',
    'Card',
    'CardTitle',
    'Dialog',
    'DialogContent',
  ]);
  const { project: source } = system.provenance as Extract<
    typeof system.provenance,
    { project: unknown }
  >;
  assert.deepEqual(source.files, [
    'components.json',
    'app/globals.css',
    'tailwind.config.ts',
    'tsconfig.json',
    'lib/utils.ts',
  ]);
  assert.equal(source.library?.components.DialogContent, 'components/ui/dialog.tsx');
  assert.equal(source.library?.tokens['--ds-primary'], '--primary');
  assert.equal(source.library?.tokens['--ds-radius'], '--radius');

  // Aliases point at the kit's own files, and the server directive is gone.
  const dialog = system.files['components/ui/dialog.tsx'];
  assert.match(dialog, /from "\.\.\/\.\.\/lib\/utils"/);
  assert.match(dialog, /import \{ buttonVariants \} from "\.\/button"/);
  assert.doesNotMatch(dialog, /use client|@\//);
  const theme = JSON.parse(system.files['tailwind.theme.json']) as Record<
    string,
    Record<string, string>
  >;
  assert.equal(theme.colors.primary, 'var(--ds-primary)');
  assert.equal(theme.colors['primary-foreground'], 'var(--ds-primary-foreground)');
  assert.equal(theme.borderRadius.md, 'calc(var(--ds-radius) - 2px)');
  const styles = system.files['styles.css'];
  assert.doesNotMatch(styles, /@tailwind|--primary|:root/);
  assert.match(styles, /@apply border-border/);

  assert.deepEqual(
    diagnostics.map(({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`),
    [
      'manual_interpretation_required tailwind.config.ts:25',
      'manual_interpretation_required tailwind.config.ts:',
      'unsupported_import components/ui/sonner.tsx:',
      'unsupported_import components/ui/notice.tsx:',
    ],
  );
  assert.match(diagnostics[0].message, /^theme\.extend\.fontFamily\.sans is computed/);
  assert.match(diagnostics[1].message, /theme\.extend\.keyframes, theme\.extend\.animation/);
  assert.match(diagnostics[2].message, /imports next-themes/);

  const previews = new KitPreviews();
  t.after(() => previews.close());
  assert.deepEqual(await previews.check(system), []);
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);
  const built = await buildDesignStylesheet({}, system);
  assert.ok(built.ok);
  assert.match(built.css, /\.bg-primary\s*\{[^}]*var\(--ds-primary\)/);
  assert.match(built.css, /\.rounded-md\s*\{[^}]*calc\(var\(--ds-radius\) - 2px\)/);
});

test('copied rules and components read the kit tokens, even where --border and --ds-border both exist', async (t) => {
  const files = {
    ...LIBRARY,
    'app/globals.css':
      LIBRARY['app/globals.css'].replace(
        '--radius: 0.5rem;',
        `--radius: 0.5rem;
    --ds-border: 0 0% 50%;`,
      ) + '.sample { color: hsl(var(--primary) / 0.5); border-color: hsl(var(--border)); }\n',
    'components/ui/badge.tsx': `export function Badge() {
  return <span className="bg-[hsl(var(--primary)/0.5)]" style={{ outlineColor: "hsl(var(--ds-border))" }} />
}
`,
  };
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const { system } = imported;
  assert.equal(imported.kitNames['--border'], '--border');
  assert.equal(imported.kitNames['--ds-border'], '--ds-border');
  assert.match(
    system.files['styles.css'],
    /\.sample \{ color: color-mix\(in srgb, var\(--ds-primary\) 50%, transparent\); border-color: var\(--border\); \}/,
  );
  const badge = system.files['components/ui/badge.tsx'];
  assert.match(badge, /"bg-\[color-mix\(in_srgb,_var\(--ds-primary\)_50%,_transparent\)\]"/);
  assert.match(badge, /outlineColor: "var\(--ds-border\)"/);
  const built = await buildDesignStylesheet({}, system);
  assert.ok(built.ok);
  assert.match(built.css, /color-mix\(in srgb, var\(--ds-primary\) 50%, transparent\)/);
});

test('a library past the component bound keeps the first by name and names the rest', async (t) => {
  // Without the two components left out, every one past the bound is a part.
  const files = Object.fromEntries(
    Object.entries(LIBRARY).filter(([path]) => !/\/(?:sonner|notice)\.tsx$/.test(path)),
  );
  for (let index = 0; index < MAX_LIBRARY_COMPONENTS + 2; index += 1) {
    const name = `part-${String(index).padStart(2, '0')}`;
    files[`components/ui/${name}.tsx`] =
      `export function Part${String(index)}() {\n  return <div />\n}\n`;
  }
  const imported = await importProjectDesignSystem(await project(t, files), SHADCN, KIT);
  assert.equal(imported.status, 'imported');
  const copied = Object.keys(imported.system.files).filter((path) =>
    path.startsWith('components/'),
  );
  assert.equal(copied.length, MAX_LIBRARY_COMPONENTS);
  assert.ok(copied.includes('components/ui/button.tsx'));
  assert.match(
    imported.diagnostics[0].message,
    /leaves out part-45, part-46, part-47, part-48, part-49\.$/,
  );
});

test('a Tailwind 4 library, an alias tsconfig does not map, and a mixed source are refused', async (t) => {
  const tailwind4 = {
    ...LIBRARY,
    'components.json': JSON.stringify({
      ...COMPONENTS_JSON,
      tailwind: { config: '', css: 'app/globals.css' },
    }),
    'app/globals.css': '@import "tailwindcss";\n',
  };
  const unmapped = { ...LIBRARY, 'tsconfig.json': '{ "compilerOptions": {} }' };
  const refusals: [
    Record<string, string>,
    typeof SHADCN | { path: string; kind: 'css' | 'shadcn' }[],
    string,
  ][] = [
    [tailwind4, SHADCN, TAILWIND_4_REFUSAL],
    [unmapped, SHADCN, "tsconfig.json's paths do not say where @/components/ui points."],
    [
      LIBRARY,
      [...SHADCN, { path: 'app/globals.css', kind: 'css' }],
      'Name components.json alone: it names every file a shadcn/ui kit reads.',
    ],
  ];
  for (const [files, sources, message] of refusals) {
    const result = await importProjectDesignSystem(await project(t, files), sources, KIT);
    assert.equal(result.status, 'refused');
    assert.equal(result.diagnostics[0].message, message);
  }
});
