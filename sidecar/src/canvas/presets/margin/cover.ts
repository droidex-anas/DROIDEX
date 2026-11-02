export const COVER_TSX = `import { Bookmark, Headphones, Search } from 'lucide-react';
import { Button } from '@droidex/design-system';

const SECTIONS = ['Essays', 'Interviews', 'Field notes', 'Letters', 'Archive'];

// Words per sentence in the first sentence of front-page leads, by decade.
const DECADES = [
  { decade: '1920', words: 31 },
  { decade: '1930', words: 30 },
  { decade: '1940', words: 29 },
  { decade: '1950', words: 27 },
  { decade: '1960', words: 26 },
  { decade: '1970', words: 24 },
  { decade: '1980', words: 22 },
  { decade: '1990', words: 20 },
  { decade: '2000', words: 19 },
  { decade: '2010', words: 18 },
  { decade: '2020', words: 17 },
];

export default function Cover() {
  return (
    <main className="relative h-[480px] w-[1200px] overflow-hidden bg-[color:var(--ds-canvas)]">
      <header className="mx-14 flex h-16 items-center gap-10 border-b border-[color:var(--ds-border-strong)]">
        <span className="ds-heading italic">Margin</span>
        <nav className="flex items-center gap-6" aria-label="Sections">
          {SECTIONS.map((section) => (
            <span
              key={section}
              className={section === 'Essays' ? 'ds-label' : 'ds-label ds-text-muted'}
            >
              {section}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="quiet" aria-label="Search">
            <Search size={18} aria-hidden="true" />
          </Button>
          <Button variant="secondary">Sign in</Button>
          <Button>Subscribe</Button>
        </div>
      </header>

      <div className="mx-14 grid grid-cols-[640px_1fr] gap-16 pt-10">
        <article className="flex flex-col">
          <span className="ds-kicker">Essay · Language</span>
          <h1 className="ds-display mt-3">The long sentence is coming back</h1>
          <p className="ds-dek mt-4">
            Front-page sentences shrank for a century. Newsletters, of all things, are letting them
            breathe again.
          </p>
          <div className="ds-byline mt-5 flex items-center gap-3">
            <span>
              By <strong>Ines Marchetti</strong> · 12 March 2025 · 11 min read
            </span>
            <Button variant="quiet" className="ml-auto">
              <Headphones size={16} aria-hidden="true" />
              Listen
            </Button>
            <Button variant="quiet">
              <Bookmark size={16} aria-hidden="true" />
              Save
            </Button>
          </div>
          <hr className="ds-rule mt-4" />
          <div className="ds-prose mt-6">
            <p className="ds-dropcap">
              Ask an editor in 1925 how long a sentence should be and you would get a shrug. Ask one
              in 1995 and you would get a number: twenty, perhaps fewer.<span className="ds-noteref">1</span> Somewhere in
              between, the sentence learned to hurry, and readers learned to expect it to.
            </p>
          </div>
        </article>

        <aside className="flex flex-col gap-6">
          <figure className="ds-card m-0 flex flex-col gap-4 p-5">
            <figcaption className="flex flex-col gap-1">
              <span className="ds-kicker">Figure 1</span>
              <span className="ds-label">Words in the first sentence of a front-page lead</span>
            </figcaption>
            <div className="flex h-32 items-end gap-1.5 border-b border-[color:var(--ds-border-strong)]">
              {DECADES.map(({ decade, words }) => (
                <span
                  key={decade}
                  title={decade + ': ' + words + ' words'}
                  className="flex-1 rounded-t-[var(--ds-radius-xs)] bg-[color:var(--ds-fg-quiet)]"
                  style={{ height: words * 4 }}
                />
              ))}
              <span className="w-3" />
              <span
                title="Newsletters, 2024: 24 words"
                className="flex-1 rounded-t-[var(--ds-radius-xs)] bg-[color:var(--ds-accent)]"
                style={{ height: 96 }}
              />
            </div>
            <div className="ds-caption ds-text-muted ds-tabular -mt-2 flex gap-1.5">
              {DECADES.map(({ decade }) => (
                <span key={decade} className="min-w-0 flex-1 whitespace-nowrap">
                  {['1920', '1970', '2020'].includes(decade) ? decade : ''}
                </span>
              ))}
              <span className="w-3" />
              <span className="ds-text-accent min-w-0 flex-1 whitespace-nowrap">2024</span>
            </div>
            <div className="ds-caption ds-text-muted flex items-center gap-2">
              <span className="h-2 w-2 bg-[color:var(--ds-fg-quiet)]" />
              Front-page leads
              <span className="ml-3 h-2 w-2 bg-[color:var(--ds-accent)]" />
              Newsletters
            </div>
          </figure>
          <p className="ds-sidenote m-0">
            <span className="ds-text-accent">1</span> The sample takes the first sentence of the
            lead story on twelve days a year from eight English-language dailies. Wire copy is left
            out.
          </p>
        </aside>
      </div>
    </main>
  );
}
`;
