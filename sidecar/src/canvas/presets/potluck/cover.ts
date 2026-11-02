export const COVER_TSX = `import { CakeSlice, CalendarDays, Check, ChevronLeft, CookingPot, Link2, MapPin, Salad, Sandwich, Soup, Wine } from 'lucide-react';
import { Button } from '@droidex/design-system';

const GUESTS = [
  { initials: 'A', tint: 'ds-avatar bg-[color:var(--ds-tint-peach)]' },
  { initials: 'L', tint: 'ds-avatar bg-[color:var(--ds-tint-mint)]' },
  { initials: 'M', tint: 'ds-avatar bg-[color:var(--ds-tint-rose)]' },
  { initials: 'J', tint: 'ds-avatar bg-[color:var(--ds-tint-sky)]' },
  { initials: '+8', tint: 'ds-avatar bg-[color:var(--ds-elevated)]' },
];

const DISHES = [
  { dish: 'Jollof rice', who: 'Ama', icon: Soup, tile: 'ds-tile bg-[color:var(--ds-tint-butter)]' },
  { dish: 'Charred corn salad', who: 'Leo', icon: Salad, tile: 'ds-tile bg-[color:var(--ds-tint-mint)]' },
  { dish: 'Lemon olive oil cake', who: 'Mira', icon: CakeSlice, tile: 'ds-tile bg-[color:var(--ds-tint-rose)]' },
  { dish: 'Something to drink', who: null, icon: Wine, tile: 'ds-tile bg-[color:var(--ds-tint-sky)]' },
  { dish: 'Plantain chips', who: null, icon: Sandwich, tile: 'ds-tile bg-[color:var(--ds-tint-peach)]' },
];

export default function Cover() {
  return (
    <main className="relative h-[480px] w-[1200px] overflow-hidden bg-[color:var(--ds-surface)]">
      <div className="absolute bottom-12 left-12 top-12 flex w-[336px] flex-col">
        <p className="ds-heading">Potluck</p>
        <div className="mt-auto flex flex-col gap-4">
          <h1 className="ds-title">Everyone brings something.</h1>
          <p className="ds-body ds-text-secondary">
            Nunito, warm cream and basil green, for the apps people open with friends: plans, sign-up
            sheets and lists that fill themselves in.
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="ds-chip" aria-pressed="true">
              <Check size={16} aria-hidden="true" />
              Vegetarian 5
            </span>
            <span className="ds-chip">Nut-free 2</span>
            <span className="ds-chip">No pork 1</span>
          </div>
        </div>
      </div>

      <div className="absolute left-[432px] top-12 h-[520px] w-[880px] overflow-hidden rounded-tl-[var(--ds-radius-2xl)] bg-[color:var(--ds-canvas)] shadow-[var(--ds-shadow-lg)]">
        <div className="border-b border-[color:var(--ds-border)]">
          <div className="flex h-14 w-[744px] items-center justify-between px-6">
            <span className="ds-label ds-text-muted flex items-center gap-1">
              <ChevronLeft size={16} aria-hidden="true" />
              Plans
            </span>
            <Button variant="secondary">
              <Link2 size={16} aria-hidden="true" />
              Copy invite link
            </Button>
          </div>
        </div>

        <div className="flex gap-6 px-6 pt-5">
          <div className="ds-card flex w-[328px] flex-col overflow-hidden shadow-[var(--ds-shadow-md)]">
            <div className="flex h-20 items-end bg-[color:var(--ds-tint-peach)] px-5 pb-4">
              <span className="ds-tile bg-[color:var(--ds-raised)]">
                <CookingPot size={20} aria-hidden="true" />
              </span>
            </div>
            <div className="flex flex-col gap-3 p-5">
              <h2 className="ds-subheading">Saturday supper at Ama's</h2>
              <div className="ds-label ds-text-secondary flex flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  <CalendarDays size={16} aria-hidden="true" />
                  Sat 22 March · 7 pm
                </span>
                <span className="flex items-center gap-2">
                  <MapPin size={16} aria-hidden="true" />
                  14 Rye Lane, flat 3
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="ds-avatars">
                  {GUESTS.map((guest) => (
                    <span key={guest.initials} className={guest.tint}>
                      {guest.initials}
                    </span>
                  ))}
                </div>
                <span className="ds-label ds-text-muted">12 going</span>
              </div>
              <div className="mt-1 flex gap-2">
                <Button className="flex-1" aria-pressed="true">
                  <Check size={16} aria-hidden="true" />
                  You're going
                </Button>
                <Button variant="secondary">Maybe</Button>
              </div>
            </div>
          </div>

          <div className="ds-card flex w-[344px] flex-col p-3 shadow-[var(--ds-shadow-md)]">
            <div className="flex h-8 items-center justify-between px-1.5">
              <span className="ds-label">Who's bringing what</span>
              <span className="ds-caption ds-text-muted">3 of 5</span>
            </div>
            {DISHES.map(({ dish, who, icon: Icon, tile }) => (
              <div key={dish} className="flex items-center gap-3 p-1">
                <span className={tile}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="ds-label truncate">{dish}</span>
                  <span className={who ? 'ds-caption ds-text-muted' : 'ds-caption text-[color:var(--ds-accent)]'}>
                    {who ? who + ' is on it' : 'Up for grabs'}
                  </span>
                </div>
                {who ? (
                  <Check size={16} aria-hidden="true" className="text-[color:var(--ds-positive)]" />
                ) : (
                  <span className="ds-chip">Claim</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
`;
