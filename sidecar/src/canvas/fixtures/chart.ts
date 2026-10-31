import type { SourceFiles } from '../schema.js';

export const CHART_DESIGN: SourceFiles = {
  'main.tsx': `import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

const weekly = [
  { day: 'Mon', visits: 12 },
  { day: 'Tue', visits: 19 },
  { day: 'Wed', visits: 15 },
];

export default function WeeklyVisits() {
  return (
    <section aria-label="Weekly visits chart">
      <h1>Weekly visits</h1>
      <BarChart width={480} height={260} data={weekly}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" />
        <YAxis />
        <Bar dataKey="visits" fill="#4f6fbe" />
      </BarChart>
    </section>
  );
}
`,
};
