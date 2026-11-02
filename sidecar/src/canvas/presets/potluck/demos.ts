export const EVENT_TSX = `import { useState } from 'react';
import { CakeSlice, CalendarDays, Check, CookingPot, MapPin, Salad, Sandwich, Soup, Wine } from 'lucide-react';
import { Button, Card, Dialog, Input, Tabs } from '@droidex/design-system';

const START = [
  { slot: 'Main', dish: 'Jollof rice', who: 'Ama', icon: Soup, tile: 'ds-tile bg-[color:var(--ds-tint-butter)]' },
  { slot: 'Side', dish: 'Charred corn salad', who: 'Leo', icon: Salad, tile: 'ds-tile bg-[color:var(--ds-tint-mint)]' },
  { slot: 'Dessert', dish: 'Lemon olive oil cake', who: 'Mira', icon: CakeSlice, tile: 'ds-tile bg-[color:var(--ds-tint-rose)]' },
  { slot: 'Drinks', dish: '', who: '', icon: Wine, tile: 'ds-tile bg-[color:var(--ds-tint-sky)]' },
  { slot: 'Snack', dish: '', who: '', icon: Sandwich, tile: 'ds-tile bg-[color:var(--ds-tint-peach)]' },
];

const DIETS = ['Vegetarian', 'Nut-free', 'No pork', 'Gluten-free'];

const GUESTS = [
  { name: 'Ama', tint: 'ds-avatar bg-[color:var(--ds-tint-peach)]' },
  { name: 'Leo', tint: 'ds-avatar bg-[color:var(--ds-tint-mint)]' },
  { name: 'Mira', tint: 'ds-avatar bg-[color:var(--ds-tint-rose)]' },
  { name: 'Jonah', tint: 'ds-avatar bg-[color:var(--ds-tint-sky)]' },
  { name: 'Priya', tint: 'ds-avatar bg-[color:var(--ds-tint-butter)]' },
];

export default function Event() {
  const [rsvp, setRsvp] = useState('going');
  const [diets, setDiets] = useState<string[]>(['Vegetarian']);
  const [dishes, setDishes] = useState(START);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [dish, setDish] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const toggleDiet = (diet: string) =>
    setDiets((current) => (current.includes(diet) ? current.filter((each) => each !== diet) : [...current, diet]));
  const claim = () => {
    if (dish.trim() === '') {
      setError('Tell everyone what you are bringing, even if it is just "crisps".');
      return;
    }
    setDishes(dishes.map((each) => (each.slot === claiming ? { ...each, dish: dish.trim(), who: 'You' } : each)));
    setToast("You're bringing " + dish.trim() + '. Ama has been told.');
    setClaiming(null);
    setDish('');
    setError('');
  };
  const reply = (value: string, label: string, message: string) => ({
    value,
    label,
    content: <p className="ds-body ds-text-secondary m-0">{message}</p>,
  });
  const claimed = dishes.filter((each) => each.who).length;

  return (
    <main className="min-h-screen bg-[color:var(--ds-canvas)] p-8">
      <div className="mx-auto grid max-w-[1080px] grid-cols-[1fr_400px] items-start gap-6">
        <Card className="flex flex-col overflow-hidden !p-0">
          <div className="flex h-28 items-end bg-[color:var(--ds-tint-peach)] px-6 pb-5">
            <span className="ds-tile bg-[color:var(--ds-raised)]">
              <CookingPot size={20} aria-hidden="true" />
            </span>
          </div>
          <div className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-2">
              <h1 className="ds-heading">Saturday supper at Ama's</h1>
              <div className="ds-label ds-text-secondary flex gap-5">
                <span className="flex items-center gap-2">
                  <CalendarDays size={16} aria-hidden="true" />
                  Sat 22 March · 7 pm
                </span>
                <span className="flex items-center gap-2">
                  <MapPin size={16} aria-hidden="true" />
                  14 Rye Lane, flat 3
                </span>
              </div>
            </div>
            <p className="ds-body m-0">
              Spring is finally here, so let's eat together. I'm making a big pot of jollof; bring whatever you love to
              cook. Kids and plus-ones welcome.
            </p>
            <section className="flex flex-col gap-3" aria-label="Your reply">
              <span className="ds-label">Are you coming?</span>
              <Tabs
                label="Your reply"
                value={rsvp}
                onValueChange={setRsvp}
                items={[
                  reply('going', 'Going', 'See you Saturday. Ama will share the door code on the day.'),
                  reply('maybe', 'Maybe', 'Ama will hold a seat for you until Thursday.'),
                  reply('no', "Can't make it", 'Thanks for letting Ama know. Next time!'),
                ]}
              />
            </section>
            <section className="flex flex-col gap-3" aria-label="Dietary needs">
              <span className="ds-label">Anything you can't eat?</span>
              <div className="flex flex-wrap gap-2">
                {DIETS.map((diet) => (
                  <button key={diet} type="button" className="ds-chip" aria-pressed={diets.includes(diet)} onClick={() => toggleDiet(diet)}>
                    {diets.includes(diet) ? <Check size={16} aria-hidden="true" /> : null}
                    {diet}
                  </button>
                ))}
              </div>
            </section>
            <section className="flex items-center gap-3" aria-label="Guests">
              <div className="ds-avatars">
                {GUESTS.map((guest) => (
                  <span key={guest.name} className={guest.tint} title={guest.name}>
                    {guest.name[0]}
                  </span>
                ))}
              </div>
              <span className="ds-label ds-text-muted">Ama, Leo, Mira and 9 others are going</span>
            </section>
          </div>
        </Card>

        <Card className="flex flex-col gap-1 !p-4">
          <div className="flex items-center justify-between px-1.5 pb-2">
            <h2 className="ds-subheading">Who's bringing what</h2>
            <span className="ds-caption ds-text-muted">{claimed + ' of ' + dishes.length}</span>
          </div>
          {dishes.map(({ slot, dish: name, who, icon: Icon, tile }) => (
            <div key={slot} className="flex items-center gap-3 rounded-[var(--ds-radius-md)] p-1.5">
              <span className={tile}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="ds-label truncate">{name || slot}</span>
                <span className={who ? 'ds-caption ds-text-muted' : 'ds-caption text-[color:var(--ds-accent)]'}>
                  {who ? slot + ' · ' + (who === 'You' ? "you're on it" : who + ' is on it') : 'Up for grabs'}
                </span>
              </div>
              {who ? (
                <Check size={16} aria-hidden="true" className="text-[color:var(--ds-positive)]" />
              ) : (
                <Button variant="secondary" onClick={() => setClaiming(slot)}>
                  Claim
                </Button>
              )}
            </div>
          ))}
        </Card>
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2" aria-live="polite">
        {toast ? (
          <div className="ds-toast">
            <span className="ds-avatar bg-[color:var(--ds-tint-mint)]">
              <Check size={16} aria-hidden="true" />
            </span>
            <span className="ds-label">{toast}</span>
          </div>
        ) : null}
      </div>

      <Dialog open={claiming !== null} onClose={() => setClaiming(null)} title={'Bring the ' + (claiming ?? '').toLowerCase()}>
        <Input
          label="What are you bringing?"
          placeholder="Hibiscus iced tea"
          hint="Say if it has nuts or meat, so people can plan."
          value={dish}
          error={error}
          onChange={(event) => setDish(event.target.value)}
        />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setClaiming(null)}>
            Not yet
          </Button>
          <Button onClick={claim}>I'll bring it</Button>
        </div>
      </Dialog>
    </main>
  );
}
`;

export const PLANS_TSX = `import { useState } from 'react';
import { CalendarDays, CookingPot, Plus } from 'lucide-react';
import { Badge, Button, Card, Dialog, Input, Tabs } from '@droidex/design-system';

const PLANS = [
  { title: "Saturday supper at Ama's", when: 'Sat 22 March · 7 pm', going: 12, claimed: 3, dishes: 5, band: 'h-16 bg-[color:var(--ds-tint-peach)]', group: 'upcoming' },
  { title: 'Allotment harvest lunch', when: 'Sun 6 April · 1 pm', going: 8, claimed: 6, dishes: 8, band: 'h-16 bg-[color:var(--ds-tint-mint)]', group: 'upcoming' },
  { title: "Theo's leaving do", when: 'Fri 11 April · 6:30 pm', going: 21, claimed: 2, dishes: 10, band: 'h-16 bg-[color:var(--ds-tint-sky)]', group: 'upcoming' },
  { title: 'Book club: Piranesi', when: 'Thu 27 February', going: 7, claimed: 7, dishes: 7, band: 'h-16 bg-[color:var(--ds-tint-rose)]', group: 'past' },
];

export default function Plans() {
  const [tab, setTab] = useState('upcoming');
  const [plans, setPlans] = useState(PLANS);
  const [starting, setStarting] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState('');
  const start = () => {
    if (title.trim() === '') {
      setError('Give it a name your friends will recognise.');
      return;
    }
    setPlans([{ title: title.trim(), when: when || 'Date to be agreed', going: 1, claimed: 0, dishes: 6, band: 'h-16 bg-[color:var(--ds-tint-butter)]', group: 'hosting' }, ...plans]);
    setTab('hosting');
    setStarting(false);
    setTitle('');
    setWhen('');
    setError('');
  };
  const list = (group: string) => {
    const shown = plans.filter((plan) => plan.group === group);
    if (shown.length === 0)
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="ds-tile bg-[color:var(--ds-tint-butter)]">
            <CookingPot size={20} aria-hidden="true" />
          </span>
          <p className="ds-subheading m-0">You're not hosting anything yet</p>
          <p className="ds-body ds-text-muted m-0">Pick a date, invite a few people and let them choose what to bring.</p>
          <Button onClick={() => setStarting(true)}>Start a potluck</Button>
        </div>
      );
    return (
      <div className="grid grid-cols-3 gap-4">
        {shown.map((plan) => (
          <Card key={plan.title} className="flex flex-col overflow-hidden !p-0">
            <div className={plan.band} />
            <div className="flex flex-col gap-2 p-5">
              <h2 className="ds-subheading">{plan.title}</h2>
              <span className="ds-label ds-text-secondary flex items-center gap-2">
                <CalendarDays size={16} aria-hidden="true" />
                {plan.when}
              </span>
              <div className="mt-2 flex items-center justify-between">
                <span className="ds-caption ds-text-muted">{plan.going + ' going'}</span>
                {plan.claimed === plan.dishes ? (
                  <Badge>All dishes claimed</Badge>
                ) : (
                  <span className="ds-caption ds-text-muted">{plan.claimed + ' of ' + plan.dishes + ' dishes'}</span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[color:var(--ds-canvas)] px-10 py-8">
      <header className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="ds-title">Hi Jess</h1>
          <p className="ds-body ds-text-secondary m-0">Three plans coming up. Leo still needs a dessert for Theo's.</p>
        </div>
        <Button className="ml-auto" onClick={() => setStarting(true)}>
          <Plus size={20} aria-hidden="true" />
          Start a potluck
        </Button>
      </header>
      <div className="mt-8">
        <Tabs
          label="Plans"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'upcoming', label: 'Upcoming', content: list('upcoming') },
            { value: 'hosting', label: 'Hosting', content: list('hosting') },
            { value: 'past', label: 'Past', content: list('past') },
          ]}
        />
      </div>
      <Dialog open={starting} onClose={() => setStarting(false)} title="Start a potluck">
        <div className="flex flex-col gap-4">
          <Input label="What's the occasion?" placeholder="Sunday roast at mine" value={title} error={error} onChange={(event) => setTitle(event.target.value)} />
          <Input label="When" type="date" value={when} onChange={(event) => setWhen(event.target.value)} hint="You can leave this for the group to vote on." />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setStarting(false)}>
            Cancel
          </Button>
          <Button onClick={start}>Create and invite</Button>
        </div>
      </Dialog>
    </main>
  );
}
`;
