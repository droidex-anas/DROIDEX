export const ARTICLE_TSX = `import { useState } from 'react';
import { Bookmark, BookmarkCheck, Headphones, Pause } from 'lucide-react';
import { Button, Card, Input, Tabs } from '@droidex/design-system';

const NOTES = [
  'The sample takes the first sentence of the lead story on twelve days a year from eight English-language dailies. Wire copy is left out.',
  'Readability formulas from the 1940s on scored a long sentence as hard to read, and newsrooms wrote them into house style.',
  'Counted across 400 newsletters with more than 10,000 subscribers each, in March 2024.',
];

const SIZES: Record<string, string> = {
  small: 'ds-prose mt-8 text-[length:var(--ds-text-base)]',
  default: 'ds-prose mt-8',
  large: 'ds-prose mt-8 text-[length:var(--ds-text-lg)]',
};

export default function Article() {
  const [note, setNote] = useState<number | null>(null);
  const [size, setSize] = useState('default');
  const [saved, setSaved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [subscribed, setSubscribed] = useState('');
  const ref = (index: number) => (
    <button
      type="button"
      className="ds-noteref"
      aria-label={'Note ' + (index + 1)}
      aria-expanded={note === index}
      onClick={() => setNote(note === index ? null : index)}
    >
      {index + 1}
    </button>
  );
  const subscribe = () => {
    if (!email.includes('@')) {
      setError('Enter an email address with an @, like name@example.com.');
      return;
    }
    setError('');
    setSubscribed(email);
  };
  const sizeTab = (value: string, label: string) => ({ value, label, content: null });

  return (
    <main className="min-h-screen bg-[color:var(--ds-canvas)]">
      <header className="mx-auto flex h-14 max-w-[1044px] items-center border-b border-[color:var(--ds-border-strong)]">
        <span className="ds-subheading italic">Margin</span>
        <span className="ds-caption ds-text-muted ml-4">Essays</span>
        <Button className="ml-auto">Subscribe</Button>
      </header>
      <div className="mx-auto grid max-w-[1044px] grid-cols-[680px_300px] gap-16 pb-16 pt-10">
        <article>
          <span className="ds-kicker">Essay · Language</span>
          <h1 className="ds-title mt-3">The long sentence is coming back</h1>
          <p className="ds-dek mt-4">
            Front-page sentences shrank for a century. Newsletters, of all things, are letting them breathe again.
          </p>
          <div className="ds-byline mt-6 flex items-center gap-2">
            <span>
              By <strong>Ines Marchetti</strong> · 12 March 2025 · 11 min read
            </span>
            <Button variant="quiet" className="ml-auto" aria-pressed={playing} onClick={() => setPlaying(!playing)}>
              {playing ? <Pause size={16} aria-hidden="true" /> : <Headphones size={16} aria-hidden="true" />}
              {playing ? 'Pause' : 'Listen'}
            </Button>
            <Button variant="quiet" aria-pressed={saved} onClick={() => setSaved(!saved)}>
              {saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
          <hr className="ds-rule mt-3" />
          <div className={SIZES[size]}>
            <p className="ds-dropcap">
              Ask an editor in 1925 how long a sentence should be and you would get a shrug. Ask one in 1995 and
              you would get a number: twenty, perhaps fewer.{ref(0)} Somewhere in between, the sentence learned to
              hurry, and readers learned to expect it to.
            </p>
            <p>
              The reasons were sensible. Telegraph tolls rewarded the short line, radio trained the ear for it, and a
              generation of readability formulas{ref(1)} gave editors a way to measure what had been a matter of
              taste. A number is easy to enforce, and so it was.
            </p>
            <blockquote className="ds-pullquote my-8">
              A number is easy to enforce. A rhythm has to be heard.
            </blockquote>
            <p>
              Newsletters broke the rule without meaning to. Written by one person, read by people who chose them,
              they sound like letters again, and letters have always let a thought run on until it is finished.
              Their opening sentences now average twenty-four words.{ref(2)}
            </p>
          </div>
        </article>

        <aside className="flex flex-col gap-8 pt-2">
          <section className="flex flex-col gap-1" aria-label="Text size">
            <span className="ds-overline ds-text-muted">Text size</span>
            <div className="-mb-4">
              <Tabs
                label="Text size"
                value={size}
                onValueChange={setSize}
                items={[sizeTab('small', 'Small'), sizeTab('default', 'Default'), sizeTab('large', 'Large')]}
              />
            </div>
          </section>
          <section className="flex flex-col gap-4" aria-label="Notes">
            <span className="ds-overline ds-text-muted">Notes</span>
            {NOTES.map((text, index) => (
              <p
                key={text}
                className={note === index ? 'ds-sidenote m-0 text-[color:var(--ds-fg)]' : 'ds-sidenote m-0'}
              >
                <span className="ds-text-accent">{index + 1}</span> {text}
              </p>
            ))}
          </section>
          <Card className="flex flex-col gap-4 !p-5">
            <div className="flex flex-col gap-1">
              <h2 className="ds-subheading">The Sunday letter</h2>
              <p className="ds-caption ds-text-muted m-0">One long read every Sunday morning. Unsubscribe in one click.</p>
            </div>
            {subscribed ? (
              <p className="ds-body m-0" aria-live="polite">
                Check your inbox. We sent a confirmation link to <strong>{subscribed}</strong>.
              </p>
            ) : (
              <>
                <Input
                  label="Email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  error={error}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <Button onClick={subscribe}>Get the letter</Button>
              </>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}
`;

export const ARCHIVE_TSX = `import { useState } from 'react';
import { Gift, Search } from 'lucide-react';
import { Badge, Button, Dialog, Input, Tabs } from '@droidex/design-system';

const ENTRIES = [
  { date: '12 Mar', month: 'March 2025', kind: 'Essay', title: 'The long sentence is coming back', dek: 'Front-page sentences shrank for a century. Newsletters are letting them breathe again.', author: 'Ines Marchetti', minutes: 11, members: false },
  { date: '5 Mar', month: 'March 2025', kind: 'Interview', title: 'A translator on the words that will not cross', dek: 'Yoko Hayashi has spent thirty years carrying Japanese novels into English. Some words stay home.', author: 'Tomás Reyes', minutes: 18, members: true },
  { date: '26 Feb', month: 'February 2025', kind: 'Letter', title: 'Why we stopped counting clicks', dek: 'A note from the editor on what we measure now, and what we gave up.', author: 'Ruth Adeyemi', minutes: 4, members: false },
  { date: '19 Feb', month: 'February 2025', kind: 'Essay', title: 'Notes on the index card', dek: 'The humble card organised libraries, novels and, for a while, the first hypertext.', author: 'Hana Novak', minutes: 9, members: true },
  { date: '12 Feb', month: 'February 2025', kind: 'Interview', title: 'The last typesetter in Leith', dek: 'Hot metal, cold mornings and a craft that outlived its machines.', author: 'Callum Baird', minutes: 14, members: true },
  { date: '3 Feb', month: 'February 2025', kind: 'Essay', title: 'What the margins were for', dek: 'Medieval readers argued with their books in the margins. We could learn from them.', author: 'Hana Novak', minutes: 12, members: false },
];

const FILTERS: Record<string, string> = { all: '', essays: 'Essay', interviews: 'Interview', letters: 'Letter' };

export default function Archive() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [gifting, setGifting] = useState(false);
  const [term, setTerm] = useState('year');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const rows = ENTRIES.filter(
    (entry) =>
      (filter === 'all' || entry.kind === FILTERS[filter]) &&
      (entry.title + ' ' + entry.author).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const tab = (value: string, label: string) => ({ value, label, content: null });
  const send = () => {
    if (!recipient.includes('@')) {
      setError('Enter the email address the gift should go to.');
      return;
    }
    setSent(recipient);
    setRecipient('');
    setError('');
    setGifting(false);
  };

  return (
    <main className="min-h-screen bg-[color:var(--ds-canvas)] px-14 py-10">
      <header className="flex items-end gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="ds-title">Archive</h1>
          <p className="ds-dek m-0">Every essay, interview and letter since 2019.</p>
        </div>
        <Button variant="secondary" className="ml-auto" onClick={() => setGifting(true)}>
          <Gift size={16} aria-hidden="true" />
          Give a subscription
        </Button>
      </header>
      <div className="mt-8 flex items-end gap-6">
        <div className="-mb-4 flex-1">
          <Tabs
            label="Kind"
            value={filter}
            onValueChange={setFilter}
            items={[tab('all', 'All'), tab('essays', 'Essays'), tab('interviews', 'Interviews'), tab('letters', 'Letters')]}
          />
        </div>
        <div className="w-64">
          <Input label="Search the archive" placeholder="Title or author" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      <p className="ds-caption ds-text-muted mt-6" aria-live="polite">
        {sent ? 'Your gift is on its way to ' + sent + '.' : rows.length + (rows.length === 1 ? ' piece' : ' pieces')}
      </p>
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-12">
          <Search size={20} aria-hidden="true" className="text-[color:var(--ds-fg-muted)]" />
          <p className="ds-subheading m-0">Nothing in the archive matches "{query}"</p>
          <p className="ds-body ds-text-muted m-0">Try a surname, or a single word from the title.</p>
          <Button variant="secondary" onClick={() => setQuery('')}>
            Clear search
          </Button>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((entry, index) => (
            <li key={entry.title} className="flex flex-col">
              {index === 0 || rows[index - 1].month !== entry.month ? (
                <div className="mt-6 flex flex-col gap-2">
                  <span className="ds-overline">{entry.month}</span>
                  <hr className="ds-rule m-0" />
                </div>
              ) : (
                <hr className="ds-rule-thin m-0" />
              )}
              <div className="grid grid-cols-[88px_1fr_auto] gap-6 py-5">
                <span className="ds-byline ds-tabular pt-1">{entry.date}</span>
                <div className="flex flex-col gap-1">
                  <span className="ds-kicker">{entry.kind}</span>
                  <a href="#" className="ds-subheading text-[color:var(--ds-fg)] no-underline hover:underline">
                    {entry.title}
                  </a>
                  <p className="ds-body ds-text-secondary m-0">{entry.dek}</p>
                </div>
                <div className="flex flex-col items-end gap-2 pt-1">
                  <span className="ds-byline">{entry.author + ' · ' + entry.minutes + ' min'}</span>
                  {entry.members ? <Badge>Members</Badge> : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Dialog open={gifting} onClose={() => setGifting(false)} title="Give a subscription">
        <div className="flex flex-col gap-4">
          <Tabs
            label="Length"
            value={term}
            onValueChange={setTerm}
            items={[
              { value: 'quarter', label: 'Three months', content: <p className="ds-body ds-text-secondary m-0">£18, sent on the day you choose.</p> },
              { value: 'year', label: 'A year', content: <p className="ds-body ds-text-secondary m-0">£60, sent on the day you choose. Two months free.</p> },
            ]}
          />
          <Input
            label="Their email"
            type="email"
            placeholder="name@example.com"
            value={recipient}
            error={error}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setGifting(false)}>
            Cancel
          </Button>
          <Button onClick={send}>Send the gift</Button>
        </div>
      </Dialog>
    </main>
  );
}
`;
