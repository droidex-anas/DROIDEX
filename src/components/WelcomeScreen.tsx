import { useState } from 'react';
import { BrandMark } from './BrandMark';

// Quick-start menu for a fresh chat: an entry only seeds the composer with the
// beginning of a prompt (it never sends), so the user just continues typing
// the specifics.
const WELCOME_MENU = [
  {
    label: 'Explore',
    hint: 'understand this codebase',
    prompt: 'Explore and understand this codebase: ',
  },
  { label: 'Build', hint: 'a new feature, app, or tool', prompt: 'Build a new feature: ' },
  {
    label: 'Review',
    hint: 'code and suggest changes',
    prompt: 'Review this code and suggest changes: ',
  },
  { label: 'Fix', hint: 'issues and failing tests', prompt: 'Fix issues and failures: ' },
] as const;

function daypart(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

// A fresh chat picks one of these at random so the welcome screen doesn't feel
// static. Only the brand mark uses the pixel font; the greeting stays in the
// normal UI font, large and readable.
const WELCOME_LINES: ((folder?: string) => string)[] = [
  (folder) => `Good ${daypart()}. What should we build${folder ? ` in ${folder}` : ''}?`,
  () => 'What do you want to build today?',
  () => 'Ready when you are. Pick a starting point, or just type.',
];

export function WelcomeScreen({
  folder,
  onSeedPrompt,
  project,
}: {
  folder?: string;
  onSeedPrompt: (text: string) => void;
  /** Drafting a project: the composer below starts its lead, and this leads back to a chat. */
  project?: { onStartChat: () => void };
}) {
  const [line] = useState(() => WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)]);
  if (project) return <ProjectWelcome onStartChat={project.onStartChat} />;
  return (
    // A short tile scrolls the screen instead of clipping its top.
    <div className="flex min-h-full flex-col items-center justify-center px-8 py-6">
      <div className="droid-rise">
        <BrandMark size={34} className="text-droid-accent" />
      </div>
      <div
        className="droid-rise mt-6 max-w-lg text-center text-[22px] leading-snug font-semibold tracking-tight text-droid-text"
        style={{ animationDelay: '90ms' }}
      >
        {line(folder)}
      </div>
      <div className="mt-10 w-full max-w-md">
        {WELCOME_MENU.map((entry, i) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => {
              onSeedPrompt(entry.prompt);
            }}
            style={{ animationDelay: `${String(160 + i * 70)}ms` }}
            className="droid-rise group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-droid-elevated/60"
          >
            <span className="w-3 shrink-0 text-[13px] text-droid-accent opacity-0 transition-opacity group-hover:opacity-100">
              &gt;
            </span>
            <span className="w-[64px] shrink-0 text-[13px] font-medium text-droid-text-secondary transition-colors group-hover:text-droid-accent">
              {entry.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-droid-text-muted transition-colors group-hover:text-droid-text-secondary">
              {entry.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// A new project starts from the same screen and composer as a chat, so it only
// has to say what sending will do, and how to go back to starting a chat.
function ProjectWelcome({ onStartChat }: { onStartChat: () => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 py-6">
      <div className="droid-rise">
        <BrandMark size={34} className="text-droid-accent" />
      </div>
      <div
        className="droid-rise mt-6 max-w-lg text-center text-[22px] leading-snug font-semibold tracking-tight text-droid-text"
        style={{ animationDelay: '90ms' }}
      >
        Start a project
      </div>
      <p
        className="droid-rise mt-3 max-w-md text-center text-[13px] leading-6 text-droid-text-muted"
        style={{ animationDelay: '160ms' }}
      >
        Say what you want done. Its chat plans the work, asks you what it needs to know, and runs
        the parts that can go in parallel as threads.
      </p>
      <button
        type="button"
        onClick={onStartChat}
        style={{ animationDelay: '230ms' }}
        className="droid-rise mt-6 rounded-lg px-3 py-1.5 text-[13px] text-droid-text-muted transition-colors hover:bg-droid-elevated/60 hover:text-droid-text-secondary"
      >
        Start a chat instead
      </button>
    </div>
  );
}
