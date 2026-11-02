export const COVER_TSX = `import {
  Bell,
  ChartColumn,
  ChevronsUpDown,
  CircleX,
  CreditCard,
  Download,
  Ellipsis,
  LayoutDashboard,
  Plus,
  Receipt,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { Button } from '@droidex/design-system';

const NAV = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Customers', icon: Users },
  { label: 'Invoices', icon: Receipt, active: true },
  { label: 'Subscriptions', icon: CreditCard },
  { label: 'Reports', icon: ChartColumn },
  { label: 'Settings', icon: Settings },
];

const SERIES = [
  'h-2 w-10 rounded-[var(--ds-radius-pill)] bg-[color:var(--ds-chart-1)]',
  'h-2 w-10 rounded-[var(--ds-radius-pill)] bg-[color:var(--ds-chart-2)]',
  'h-2 w-10 rounded-[var(--ds-radius-pill)] bg-[color:var(--ds-chart-3)]',
  'h-2 w-10 rounded-[var(--ds-radius-pill)] bg-[color:var(--ds-chart-4)]',
  'h-2 w-10 rounded-[var(--ds-radius-pill)] bg-[color:var(--ds-chart-5)]',
];

const MONTHS = [
  { month: 'Oct', plans: 30, usage: 10 },
  { month: 'Nov', plans: 33, usage: 12 },
  { month: 'Dec', plans: 32, usage: 15 },
  { month: 'Jan', plans: 37, usage: 15 },
  { month: 'Feb', plans: 40, usage: 17 },
  { month: 'Mar', plans: 44, usage: 19 },
];

const STATUS = {
  Paid: 'ds-status text-[color:var(--ds-positive)]',
  Overdue: 'ds-status text-[color:var(--ds-danger)]',
  Draft: 'ds-status text-[color:var(--ds-fg-muted)]',
};

const INVOICES = [
  { id: 'INV-2041', customer: 'Halvorsen Logistics', due: '17 Mar', amount: '$12,480.00', status: 'Paid' },
  { id: 'INV-2040', customer: 'Brightwater Clinics', due: '16 Mar', amount: '$3,215.40', status: 'Overdue' },
  { id: 'INV-2039', customer: 'Okafor & Lane', due: '15 Mar', amount: '$8,900.00', status: 'Paid' },
  { id: 'INV-2038', customer: 'Pinecrest Schools', due: '14 Mar', amount: '$1,760.00', status: 'Draft' },
  { id: 'INV-2037', customer: 'Marlow Studio', due: '12 Mar', amount: '$642.18', status: 'Paid' },
  { id: 'INV-2036', customer: 'Tidewater Ports', due: '11 Mar', amount: '$27,300.00', status: 'Overdue' },
] as const;

export default function Cover() {
  return (
    <main
      className="relative h-[480px] w-[1200px] overflow-hidden"
      style={{ background: 'radial-gradient(1000px 640px at 12% 18%, var(--ds-surface), var(--ds-elevated) 72%)' }}
    >
      <div className="absolute bottom-14 left-14 top-14 flex w-[288px] flex-col">
        <p className="ds-subheading">Gridline</p>
        <div className="mt-auto flex flex-col gap-4">
          <h1 className="ds-title">Calm screens for busy numbers.</h1>
          <p className="ds-body ds-text-secondary">
            Manrope with tabular figures, slate surfaces and one cobalt accent, for the billing, admin and
            analytics screens people keep open all day.
          </p>
        </div>
        <div className="mt-10 flex flex-col gap-2">
          <div className="flex gap-1.5">
            {SERIES.map((series) => (
              <span key={series} className={series} />
            ))}
          </div>
          <span className="ds-caption ds-text-muted">Data series, in order</span>
        </div>
      </div>

      <div className="absolute left-[400px] top-12 flex h-[480px] w-[860px] overflow-hidden rounded-tl-[var(--ds-radius-2xl)] bg-[color:var(--ds-canvas)] shadow-[var(--ds-shadow-lg)]">
        <aside className="flex w-[184px] shrink-0 flex-col gap-0.5 bg-[color:var(--ds-surface)] px-3 pt-4">
          <div className="mb-3 flex h-8 items-center gap-2 px-2">
            <span className="ds-label">Northwind Freight</span>
            <ChevronsUpDown size={14} aria-hidden="true" className="ml-auto text-[color:var(--ds-fg-muted)]" />
          </div>
          {NAV.map(({ label, icon: Icon, active }) => (
            <div
              key={label}
              className={
                active
                  ? 'ds-label flex h-8 items-center gap-2.5 rounded-[var(--ds-radius-md)] bg-[color:var(--ds-active)] px-2'
                  : 'ds-label ds-text-secondary flex h-8 items-center gap-2.5 rounded-[var(--ds-radius-md)] px-2'
              }
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </div>
          ))}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-4 pl-6 pr-20 pt-3">
          <header className="flex h-12 items-center gap-2">
            <div className="flex flex-col">
              <span className="ds-caption ds-text-muted">Billing</span>
              <h2 className="ds-subheading">Invoices</h2>
            </div>
            <Button variant="secondary" className="ml-auto">
              <Download size={16} aria-hidden="true" />
              Export
            </Button>
            <Button>
              <Plus size={16} aria-hidden="true" />
              New invoice
            </Button>
          </header>

          <div className="grid grid-cols-[1fr_1fr_1.35fr] gap-3">
            <div className="ds-card flex flex-col gap-1 p-4 shadow-[var(--ds-shadow-sm)]">
              <span className="ds-overline ds-text-muted">Recurring revenue</span>
              <span className="ds-heading ds-tabular">$482,190</span>
              <span className="ds-caption ds-tabular text-[color:var(--ds-positive)]">+4.2% on February</span>
            </div>
            <div className="ds-card flex flex-col gap-1 p-4 shadow-[var(--ds-shadow-sm)]">
              <span className="ds-overline ds-text-muted">Overdue</span>
              <span className="ds-heading ds-tabular">$38,420</span>
              <span className="ds-caption ds-tabular text-[color:var(--ds-danger)]">23 invoices past due</span>
            </div>
            <div className="ds-card flex items-end gap-4 p-4 shadow-[var(--ds-shadow-sm)]">
              <div className="flex flex-col gap-1">
                <span className="ds-overline ds-text-muted">Billed</span>
                <span className="ds-body-strong ds-tabular">$2.71M</span>
                <span className="ds-caption ds-text-muted">Oct–Mar</span>
              </div>
              <div className="ml-auto flex h-16 items-end gap-2">
                {MONTHS.map(({ month, plans, usage }) => (
                  <div key={month} className="flex w-3.5 flex-col gap-0.5" title={month}>
                    <span className="rounded-[var(--ds-radius-xs)] bg-[color:var(--ds-chart-2)]" style={{ height: usage }} />
                    <span className="rounded-[var(--ds-radius-xs)] bg-[color:var(--ds-chart-1)]" style={{ height: plans }} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ds-card relative flex flex-col gap-2 p-2 shadow-[var(--ds-shadow-sm)]">
            <div className="flex items-center gap-1 px-1 pt-1">
              <span className="ds-label rounded-[var(--ds-radius-md)] bg-[color:var(--ds-active)] px-3 py-1.5">All 1,284</span>
              <span className="ds-label ds-text-muted px-3 py-1.5">Open 61</span>
              <span className="ds-label ds-text-muted px-3 py-1.5">Overdue 23</span>
              <span className="ds-label ds-text-muted px-3 py-1.5">Drafts 4</span>
              <div className="ml-auto flex h-7 w-44 items-center gap-2 rounded-[var(--ds-radius-md)] bg-[color:var(--ds-elevated)] px-2.5 text-[color:var(--ds-fg-muted)]">
                <Search size={14} aria-hidden="true" />
                <span className="ds-caption">Search invoices</span>
              </div>
            </div>
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Due</th>
                  <th className="ds-num">Amount</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((invoice) => (
                  <tr key={invoice.id} aria-selected={invoice.id === 'INV-2040'}>
                    <td className="ds-text-secondary">{invoice.id}</td>
                    <td style={{ fontWeight: 'var(--ds-weight-medium)' }}>{invoice.customer}</td>
                    <td className="ds-text-secondary">{invoice.due}</td>
                    <td className="ds-num">{invoice.amount}</td>
                    <td>
                      <span className={STATUS[invoice.status]}>{invoice.status}</span>
                    </td>
                    <td className="w-10 text-[color:var(--ds-fg-muted)]">
                      <span
                        className={
                          invoice.id === 'INV-2040'
                            ? 'flex h-6 w-6 items-center justify-center rounded-[var(--ds-radius-sm)] bg-[color:var(--ds-active)] text-[color:var(--ds-fg)]'
                            : 'flex h-6 w-6 items-center justify-center'
                        }
                      >
                        <Ellipsis size={16} aria-hidden="true" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ds-card absolute right-3 top-[154px] flex w-48 flex-col gap-0.5 p-1.5 shadow-[var(--ds-shadow-lg)]">
              <span className="ds-label flex h-8 items-center gap-2.5 rounded-[var(--ds-radius-md)] bg-[color:var(--ds-elevated)] px-2.5">
                <Bell size={16} aria-hidden="true" />
                Send reminder
              </span>
              <span className="ds-label flex h-8 items-center gap-2.5 px-2.5">
                <Download size={16} aria-hidden="true" />
                Download PDF
              </span>
              <span className="ds-label flex h-8 items-center gap-2.5 px-2.5 text-[color:var(--ds-danger)]">
                <CircleX size={16} aria-hidden="true" />
                Void invoice
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
`;
