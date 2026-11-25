import { runAbProbes } from '../src/lib/perfAbProbes.ts';
import { measureTerminalPump } from '../src/lib/perfAbTerminalProbe.ts';

if (process.argv[2] === '--terminal-pump') {
  const baselineRoot = process.argv[3];
  if (!baselineRoot || !globalThis.gc) {
    throw new Error(
      'Usage: node --expose-gc --import tsx tools/perf-ab-probes.ts --terminal-pump <baseline-tree> [candidate-tree]',
    );
  }
  const candidateRoot = process.argv[4] ?? process.cwd();
  const baseline = await measureTerminalPump(baselineRoot);
  const candidate = await measureTerminalPump(candidateRoot);
  console.log(`Node ${process.version}; baseline ${baselineRoot}; candidate ${candidateRoot}`);
  console.log('Median of 7 after 2 warmups; 96 pushes plus reveal, excluding prefill.');
  console.log('| Metric | Unit | Base | Branch | Base / branch |');
  console.log('|---|---|---:|---:|---:|');
  for (const metric of candidate) {
    const before = baseline.find((entry) => entry.id === metric.id);
    if (!before) throw new Error(`Missing baseline metric: ${metric.id}`);
    console.log(
      `| ${metric.id} | ${metric.unit} | ${before.value.toFixed(3)} | ${metric.value.toFixed(3)} | ${(before.value / metric.value).toFixed(2)} |`,
    );
  }
  console.log('PASS: output and droppedBytes match expected UTF-8 suffixes on both trees.');
} else {
  const treeRoot = process.argv[2] ?? process.cwd();
  const result = await runAbProbes(treeRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
