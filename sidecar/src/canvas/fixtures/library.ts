import type { SourceFiles } from '../schema.js';

// A design built the way shadcn/ui builds components: Radix primitives, both as
// the radix-ui umbrella and as a single package, cva variants and a `cn`
// helper over clsx and tailwind-merge, with tailwindcss-animate's enter classes.
export const LIBRARY_DESIGN: SourceFiles = {
  'lib/utils.ts': `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  'ui/button.tsx': `import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const buttonVariants = cva('inline-flex items-center rounded-md px-4 py-2 text-sm', {
  variants: { variant: { solid: 'bg-black text-white', outline: 'border border-black' } },
  defaultVariants: { variant: 'solid' },
});

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant }), 'px-6', className)} {...props} />;
}
`,
  'ui/dialog.tsx': `import type { ComponentProps } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;

export function DialogContent({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn('fixed left-1/2 top-1/2 rounded-lg bg-white p-6 data-[state=open]:zoom-in-95', className)}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}
`,
  'main.tsx': `import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './ui/dialog';

export default function InviteTeammates() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="outline">Invite teammates</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Invite teammates</DialogTitle>
        <Button>Send invites</Button>
      </DialogContent>
    </Dialog>
  );
}
`,
};
