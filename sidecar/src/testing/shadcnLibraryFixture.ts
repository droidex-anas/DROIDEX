// A Tailwind 3 shadcn/ui project as `shadcn init` and `shadcn add` leave it, and a
// folder to write one into.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

export const COMPONENTS_JSON = {
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

export const LIBRARY: Record<string, string> = {
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

/** The files written into a project folder named acme-web. */
export async function project(t: TestContext, files: Record<string, string>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'kit-library-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'acme-web');
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}
