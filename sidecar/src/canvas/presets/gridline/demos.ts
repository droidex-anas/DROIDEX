// The pricing card reads only the shared primitives' tokens, so it builds
// strictly under any kit made from them.
export const PRICING_TSX = `import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Card, Tabs } from '@droidex/design-system';

const PLANS = [
  { name: 'Starter', seat: 0, summary: 'For a small team on one workspace.', features: ['Up to 5 seats', 'One workspace', 'Email support'] },
  { name: 'Growth', seat: 18, summary: 'For teams that bill and report every day.', features: ['Unlimited seats', 'Audit log', 'Priority support'] },
  { name: 'Scale', seat: 32, summary: 'For finance and operations across entities.', features: ['SAML single sign-on', 'Custom roles', 'A named success manager'] },
];

export default function PricingCard() {
  const [billing, setBilling] = useState('monthly');
  const [chosen, setChosen] = useState('Starter');
  const price = (seat: number) => (billing === 'yearly' ? seat * 10 : seat);
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-[color:var(--ds-canvas)] px-10 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1>Choose a plan</h1>
        <p className="text-[color:var(--ds-fg-muted)]">Every plan includes unlimited invoices and the full API.</p>
      </div>
      <Tabs
        label="Billing period"
        value={billing}
        onValueChange={setBilling}
        items={[
          { value: 'monthly', label: 'Monthly', content: null },
          { value: 'yearly', label: 'Yearly, two months free', content: null },
        ]}
      />
      <div className="grid w-full max-w-4xl grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <Card key={plan.name} className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2>{plan.name}</h2>
              {plan.name === 'Growth' ? <Badge>Most teams</Badge> : null}
            </div>
            <p className="text-[length:var(--ds-text-sm)] text-[color:var(--ds-fg-muted)]">{plan.summary}</p>
            <p className="text-[length:var(--ds-text-xl)] font-semibold tabular-nums">
              {'$' + price(plan.seat)}
              <span className="text-[length:var(--ds-text-sm)] font-normal text-[color:var(--ds-fg-muted)]">
                {billing === 'yearly' ? ' per seat a year' : ' per seat a month'}
              </span>
            </p>
            <ul className="flex flex-1 flex-col gap-2 text-[length:var(--ds-text-sm)]">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <Check size={16} aria-hidden="true" className="text-[color:var(--ds-positive)]" />
                  {feature}
                </li>
              ))}
            </ul>
            <Button
              variant={plan.name === 'Growth' ? 'primary' : 'secondary'}
              disabled={chosen === plan.name}
              onClick={() => setChosen(plan.name)}
            >
              {chosen === plan.name ? 'Current plan' : 'Switch to ' + plan.name}
            </Button>
          </Card>
        ))}
      </div>
    </main>
  );
}
`;

export const INVOICES_TSX = `import { useState } from 'react';
import { Bell, Download, Search } from 'lucide-react';
import { Button, Card, Dialog, Input, Tabs } from '@droidex/design-system';

const INVOICES = [
  { id: 'INV-2041', customer: 'Halvorsen Logistics', issued: '3 Mar 2025', amount: 12480, status: 'Paid' },
  { id: 'INV-2040', customer: 'Brightwater Clinics', issued: '2 Mar 2025', amount: 3215.4, status: 'Overdue' },
  { id: 'INV-2039', customer: 'Okafor & Lane', issued: '1 Mar 2025', amount: 8900, status: 'Paid' },
  { id: 'INV-2038', customer: 'Pinecrest Schools', issued: '28 Feb 2025', amount: 1760, status: 'Open' },
  { id: 'INV-2037', customer: 'Marlow Studio', issued: '26 Feb 2025', amount: 642.18, status: 'Paid' },
  { id: 'INV-2036', customer: 'Tidewater Ports', issued: '25 Feb 2025', amount: 27300, status: 'Overdue' },
  { id: 'INV-2035', customer: 'Fernhill Dental', issued: '24 Feb 2025', amount: 980, status: 'Open' },
  { id: 'INV-2034', customer: 'Quarry Lane Books', issued: '21 Feb 2025', amount: 415.5, status: 'Paid' },
];

const STATUS: Record<string, string> = {
  Paid: 'ds-status text-[color:var(--ds-positive)]',
  Open: 'ds-status text-[color:var(--ds-info)]',
  Overdue: 'ds-status text-[color:var(--ds-danger)]',
};

const money = (amount: number) =>
  '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Invoices() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>(['INV-2040']);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(0);
  const rows = INVOICES.filter(
    (invoice) =>
      (filter === 'all' || invoice.status.toLowerCase() === filter) &&
      invoice.customer.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const count = (status: string) => INVOICES.filter((invoice) => invoice.status === status).length;
  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((each) => each !== id) : [...current, id]));
  const tab = (value: string, label: string) => ({ value, label, content: null });

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-[color:var(--ds-canvas)] p-6">
      <header className="flex items-center gap-2">
        <div className="flex flex-col">
          <span className="ds-caption ds-text-muted">Billing</span>
          <h1 className="ds-heading">Invoices</h1>
        </div>
        <Button variant="secondary" className="ml-auto">
          <Download size={16} aria-hidden="true" />
          Export CSV
        </Button>
      </header>
      <Card className="flex flex-col gap-2 !p-2">
        <div className="flex items-end gap-3 px-1 pt-1">
          {/* Tabs reserve a panel below the list; this filter row has none. */}
          <div className="-mb-4">
            <Tabs
              label="Invoice status"
              value={filter}
              onValueChange={setFilter}
              items={[
                tab('all', 'All ' + INVOICES.length),
                tab('open', 'Open ' + count('Open')),
                tab('overdue', 'Overdue ' + count('Overdue')),
                tab('paid', 'Paid ' + count('Paid')),
              ]}
            />
          </div>
          <div className="ml-auto w-64">
            <Input label="Customer" placeholder="Search by name" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>
        {selected.length > 0 ? (
          <div className="flex items-center gap-3 rounded-[var(--ds-radius-md)] bg-[color:var(--ds-accent-soft)] px-3 py-1.5">
            <span className="ds-label">{selected.length === 1 ? '1 invoice selected' : selected.length + ' invoices selected'}</span>
            <Button variant="quiet" className="ml-auto" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button onClick={() => setConfirming(true)}>
              <Bell size={16} aria-hidden="true" />
              Send reminders
            </Button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Search size={20} aria-hidden="true" className="text-[color:var(--ds-fg-muted)]" />
            <p className="ds-body-strong">No invoices match "{query}"</p>
            <p className="ds-caption ds-text-muted">Try another customer name, or clear the search.</p>
            <Button variant="secondary" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <table className="ds-table">
            <thead>
              <tr>
                <th className="w-10" aria-label="Select" />
                <th>Invoice</th>
                <th>Customer</th>
                <th>Issued</th>
                <th className="ds-num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => (
                <tr key={invoice.id} aria-selected={selected.includes(invoice.id)}>
                  <td>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--ds-accent)]"
                      aria-label={'Select ' + invoice.id}
                      checked={selected.includes(invoice.id)}
                      onChange={() => toggle(invoice.id)}
                    />
                  </td>
                  <td className="ds-text-secondary">{invoice.id}</td>
                  <td>{invoice.customer}</td>
                  <td className="ds-text-secondary">{invoice.issued}</td>
                  <td className="ds-num">{money(invoice.amount)}</td>
                  <td>
                    <span className={STATUS[invoice.status]}>{invoice.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="ds-caption ds-text-muted" aria-live="polite">
        {sent > 0 ? sent + ' reminders sent. Customers get them within a minute.' : 'Reminders go to the billing contact on each invoice.'}
      </p>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Send reminders">
        <p className="ds-body">
          {selected.length === 1 ? 'One customer gets' : selected.length + ' customers get'} an email with the invoice and a
          link to pay. You can send another in 3 days.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setSent(selected.length);
              setSelected([]);
              setConfirming(false);
            }}
          >
            Send {selected.length === 1 ? 'reminder' : selected.length + ' reminders'}
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
`;
