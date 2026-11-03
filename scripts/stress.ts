/**
 * Headless benchmark. Builds the small, medium and large scenarios from fixed seeds,
 * runs 20 000 ticks and prints mean and p99 ms per tick per subsystem.
 * Fails on a budget breach or a regression above 10 percent against perf-baseline.json.
 * Use `--update-baseline` to rewrite the baseline after a reviewed, intended change.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim';

const TICKS = 20_000;
const BASELINE_PATH = fileURLToPath(new URL('../perf-baseline.json', import.meta.url));
/** Ignore regressions smaller than this many ms, which is below timer noise. */
const NOISE_FLOOR_MS = 0.005;

interface Scenario {
  name: string;
  seed: string;
  aircraft: number;
  budgetMsPerTick: number;
}

const SCENARIOS: Scenario[] = [
  { name: 'small', seed: 'STRESS-SMALL', aircraft: 10, budgetMsPerTick: 1 },
  { name: 'medium', seed: 'STRESS-MEDIUM', aircraft: 50, budgetMsPerTick: 4 },
  { name: 'large', seed: 'STRESS-LARGE', aircraft: 150, budgetMsPerTick: 8 },
];

interface Stat {
  mean: number;
  p99: number;
}
type Result = Record<string, Record<string, Stat>>;

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function runScenario(s: Scenario): Record<string, Stat> {
  const sim = new Sim(s.seed, { preset: 'flatCoastal' });
  for (let i = 0; i < s.aircraft; i++) {
    sim.enqueue({
      type: 'spawnTestAircraft',
      x: (i * 523) % 8000,
      y: (i * 911) % 8000,
      heading: (i * 0.77) % 6.28,
      speed: 70,
    });
  }
  const n = sim.subsystemCount;
  const samples: Float64Array[] = [];
  for (let i = 0; i < n; i++) samples.push(new Float64Array(TICKS));
  const total = new Float64Array(TICKS);

  // Warm up so the JIT does not skew the first ticks.
  const warm = new Sim(s.seed, { preset: 'flatCoastal' });
  for (let i = 0; i < 2000; i++) warm.step();

  for (let t = 0; t < TICKS; t++) {
    let tickNs = 0n;
    for (let i = 0; i < n; i++) {
      const t0 = process.hrtime.bigint();
      sim.runSubsystem(i);
      const dt = process.hrtime.bigint() - t0;
      samples[i][t] = Number(dt) / 1e6;
      tickNs += dt;
    }
    sim.endTick();
    total[t] = Number(tickNs) / 1e6;
  }

  const out: Record<string, Stat> = {};
  const addStat = (name: string, arr: Float64Array): void => {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    const sorted = Float64Array.from(arr).sort();
    out[name] = { mean: sum / arr.length, p99: percentile(sorted, 0.99) };
  };
  for (let i = 0; i < n; i++) addStat(sim.subsystemName(i), samples[i]);
  addStat('total', total);
  return out;
}

function main(): void {
  const update = process.argv.includes('--update-baseline');
  const results: Result = {};
  let failed = false;

  for (const s of SCENARIOS) {
    results[s.name] = runScenario(s);
  }

  const baseline: Result | null = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Result)
    : null;

  for (const s of SCENARIOS) {
    const r = results[s.name];
    console.log(`\nScenario ${s.name}: ${s.aircraft} aircraft, ${TICKS} ticks, budget ${s.budgetMsPerTick} ms/tick`);
    console.log('  subsystem      mean ms     p99 ms');
    for (const [name, stat] of Object.entries(r)) {
      console.log(`  ${name.padEnd(12)} ${stat.mean.toFixed(5).padStart(9)} ${stat.p99.toFixed(5).padStart(10)}`);
    }
    if (r.total.mean > s.budgetMsPerTick) {
      console.error(`  BUDGET BREACH: mean ${r.total.mean.toFixed(4)} ms exceeds ${s.budgetMsPerTick} ms`);
      failed = true;
    }
    const base = baseline?.[s.name];
    if (base && !update) {
      for (const [name, stat] of Object.entries(r)) {
        const b = base[name];
        if (!b) continue;
        if (stat.mean > b.mean * 1.1 && stat.mean - b.mean > NOISE_FLOOR_MS) {
          console.error(`  REGRESSION: ${name} mean ${stat.mean.toFixed(5)} vs baseline ${b.mean.toFixed(5)}`);
          failed = true;
        }
      }
    }
  }

  if (update || !baseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2) + '\n');
    console.log(`\nWrote ${BASELINE_PATH}`);
  }
  if (failed) process.exit(1);
}

main();
