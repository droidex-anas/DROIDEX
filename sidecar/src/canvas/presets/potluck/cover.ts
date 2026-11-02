export const COVER_TSX = `import { CakeSlice, CalendarDays, Check, CookingPot, MapPin, Salad, Sandwich, Soup, Wine } from 'lucide-react';
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
    <main className="relative h-[480px] w-[1200px] overflow-hidden bg-[color:var(--ds-canvas)]">
      <div className="absolute -top-40 left-[500px] h-[760px] w-[760px] rounded-[var(--ds-radius-pill)] bg-[color:var(--ds-surface)]" />

      <div className="absolute bottom-14 left-14 top-14 flex w-[360px] flex-col">
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

      <div className="ds-card absolute left-[476px] top-14 flex w-[352px] flex-col overflow-hidden shadow-[var(--ds-shadow-lg)]">
        <div className="flex h-24 items-end bg-[color:var(--ds-tint-peach)] px-5 pb-4">
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

      <div className="ds-toast absolute left-[500px] top-[400px]">
        <span className="ds-avatar bg-[color:var(--ds-tint-mint)]">L</span>
        <span className="ds-label">Leo is bringing charred corn salad</span>
      </div>

      <div className="ds-card absolute left-[860px] top-[104px] flex w-[296px] flex-col gap-1 p-4 shadow-[var(--ds-shadow-md)]">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="ds-label">Who's bringing what</span>
          <span className="ds-caption ds-text-muted">3 of 5</span>
        </div>
        {DISHES.map(({ dish, who, icon: Icon, tile }) => (
          <div key={dish} className="flex items-center gap-3 rounded-[var(--ds-radius-md)] p-1.5">
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
    </main>
  );
}
`;
