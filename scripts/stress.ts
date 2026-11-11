/**
 * Headless benchmark. Builds the small, medium and large scenarios from fixed seeds,
 * runs 20 000 ticks and prints mean and p99 ms per tick per subsystem.
 * Fails on a budget breach or a regression above 10 percent against perf-baseline.json.
 * Use `--update-baseline` to rewrite the baseline after a reviewed, intended change.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim';
import { buildTestAirport } from '../tests/helpers';
import { buildWalkGraph, updateWalkGraph, type WalkGraph } from '../src/sim/terminal/walkGraph';
import { originFor, type TerminalEdit } from '../src/shared/terminalOps';

const TICKS = 20_000;
const BASELINE_PATH = fileURLToPath(new URL('../perf-baseline.json', import.meta.url));
/** Ignore regressions smaller than this many ms, which is below timer noise. */
const NOISE_FLOOR_MS = 0.005;

interface Scenario {
  name: string;
  seed: string;
  stands: number;
  perHour: number;
  budgetMsPerTick: number;
  /** Turnaround length scale, higher keeps aircraft on stands longer. */
  turnScale?: number;
  standCode?: 'A' | 'B' | 'C';
  ticks?: number;
  /** Aircraft that must be on the airport at once at some point. */
  minPeak?: number;
  /** Adds a 640 by 120 m terminal with fixtures (docs/DESIGN_REVISION_2.md section 5). */
  bigTerminal?: boolean;
  /** Adds a small terminal with a curb, check in, six security lanes, eight gate desks and seating, so departing cohorts run through it. */
  cohortTerminal?: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: 'small', seed: 'STRESS-SMALL', stands: 8, perHour: 40, budgetMsPerTick: 1 },
  { name: 'medium', seed: 'STRESS-MEDIUM', stands: 20, perHour: 120, budgetMsPerTick: 4, cohortTerminal: true },
  { name: 'large', seed: 'STRESS-LARGE', stands: 30, perHour: 240, budgetMsPerTick: 8 },
  { name: 'busy50', seed: 'STRESS-BUSY', stands: 60, standCode: 'B', perHour: 720, budgetMsPerTick: 4, turnScale: 4, ticks: 60_000, minPeak: 50 },
  { name: 'terminal640', seed: 'STRESS-TERMINAL', stands: 20, perHour: 120, budgetMsPerTick: 4, bigTerminal: true },
];

/** A 640 by 120 m terminal south of the stands, with check in, security, seating and shops laid in it. */
function buildBigTerminal(sim: Sim): void {
  const { ox, oy } = originFor(3200, 5600, 90);
  const edit = (building: number, e: TerminalEdit): void => sim.enqueue({ type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
  edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 360, y1: 100, variant: 0 });
  sim.step();
  const id = sim.business.grids[0]?.id ?? -1;
  if (id < 0) throw new Error('big terminal was not built');
  edit(id, { op: 'floor', x0: 40, y0: 40, x1: 360, y1: 100, variant: 2 });
  edit(id, { op: 'fixture', x0: 50, y0: 44, x1: 110, y1: 45, variant: 1 });
  edit(id, { op: 'fixture', x0: 150, y0: 60, x1: 170, y1: 61, variant: 2 });
  edit(id, { op: 'zone', x0: 172, y0: 40, x1: 360, y1: 100, variant: 3 });
  edit(id, { op: 'fixture', x0: 200, y0: 60, x1: 340, y1: 64, variant: 4 });
  edit(id, { op: 'wall', x0: 40, y0: 40, x1: 360, y1: 40, variant: 1 });
  sim.step();
}

/**
 * A 60 by 12 cell terminal south of the stands, at the big terminal origin, with a curb door, check in, six security
 * lanes, eight gate desks and seating. Departing cohorts walk from the curb through every service point.
 */
function buildCohortTerminal(sim: Sim): void {
  const { ox, oy } = originFor(3200, 5600, 90);
  const edit = (building: number, e: TerminalEdit): void => {
    sim.enqueue({ type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
    sim.step();
  };
  edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 100, y1: 52, variant: 0 });
  const id = sim.business.grids[sim.business.grids.length - 1]?.id ?? -1;
  if (id < 0) throw new Error('cohort terminal was not built');
  edit(id, { op: 'floor', x0: 40, y0: 40, x1: 100, y1: 52, variant: 2 });
  edit(id, { op: 'wall', x0: 40, y0: 40, x1: 100, y1: 40, variant: 1 });
  edit(id, { op: 'wall', x0: 40, y0: 52, x1: 100, y1: 52, variant: 1 });
  edit(id, { op: 'wall', x0: 70, y0: 52, x1: 72, y1: 52, variant: 3 });
  // A door needs floor on both sides to be a walk node, so the strip outside the door is floor too.
  edit(id, { op: 'foundation', x0: 68, y0: 52, x1: 74, y1: 53, variant: 0 });
  edit(id, { op: 'floor', x0: 68, y0: 52, x1: 74, y1: 53, variant: 2 });
  // The secure hall on the east side, closed by a wall with a six cell opening for the security lanes.
  edit(id, { op: 'zone', x0: 72, y0: 40, x1: 100, y1: 52, variant: 3 });
  edit(id, { op: 'wall', x0: 72, y0: 40, x1: 72, y1: 42, variant: 1 });
  edit(id, { op: 'wall', x0: 72, y0: 48, x1: 72, y1: 52, variant: 1 });
  edit(id, { op: 'fixture', x0: 42, y0: 42, x1: 54, y1: 43, variant: 1 });
  edit(id, { op: 'fixture', x0: 72, y0: 42, x1: 73, y1: 48, variant: 2 });
  edit(id, { op: 'fixture', x0: 76, y0: 44, x1: 84, y1: 45, variant: 16 });
  edit(id, { op: 'fixture', x0: 76, y0: 46, x1: 82, y1: 47, variant: 4 });
  if (sim.business.cohortGrid(0) < 0) throw new Error('cohort terminal has no eligible grid');
}

/** Median of five timed runs of fn, in ms. */
function medianMs(fn: () => void): number {
  const times: number[] = [];
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((p, q) => p - q);
  return times[2]!;
}

/** Times a full walk graph build and a 2 by 2 cell edit on the big terminal, printed once. */
function walkGraphReport(sim: Sim): string {
  const g = sim.business.grids[0];
  if (!g) throw new Error('big terminal was not built');
  let wg: WalkGraph = sim.business.walkGraphs[0]!;
  const lx = g.x0 + Math.floor(g.w / 2);
  const ly = g.y0 + Math.floor(g.h / 2);
  const build = medianMs(() => void buildWalkGraph(g));
  const edit = medianMs(() => {
    wg = updateWalkGraph(wg, g, lx, ly, lx + 1, ly + 1);
  });
  return `walk graph ${wg.nodeCount} nodes ${wg.edgeTo.length} edges, build ${build.toFixed(3)} ms, 2x2 edit ${edit.toFixed(3)} ms`;
}

interface Stat {
  mean: number;
  p99: number;
}
type Result = Record<string, Record<string, Stat>>;

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const peaks: Record<string, string> = {};
const peakCounts: Record<string, number> = {};
/** Scenarios whose cohort terminal generated no cohorts. */
const cohortFailures: string[] = [];

function runScenario(s: Scenario): Record<string, Stat> {
  const sim = new Sim(s.seed, { preset: 'flatCoastal' });
  sim.parcelOwner.fill(1);
  // Plenty of cash: the benchmark builds a big airport and is not about money.
  sim.cash = 500_000_000;
  buildTestAirport(sim, { standsPerRow: s.stands, standCode: s.standCode });
  if (s.bigTerminal) {
    buildBigTerminal(sim);
    console.log(walkGraphReport(sim));
  }
  if (s.cohortTerminal) buildCohortTerminal(sim);
  // A level 5 tower keeps the benchmark measuring traffic, not ATC starvation (handoff/tasks/T40-atc-tower.md R4).
  sim.enqueue({ type: 'buildTower', x: 2700, y: 4800, level: 5 });
  sim.enqueue({ type: 'setTestTraffic', perHour: s.perHour, turnScale: s.turnScale ?? 0.08 });
  const n = sim.subsystemCount;
  const ticks = s.ticks ?? TICKS;
  const samples: Float64Array[] = [];
  for (let i = 0; i < n; i++) samples.push(new Float64Array(ticks));
  const total = new Float64Array(ticks);

  // Warm up so the JIT does not skew the first ticks.
  const warm = new Sim(s.seed, { preset: 'flatCoastal' });
  for (let i = 0; i < 2000; i++) warm.step();

  let peak = 0;
  let peakHi = 0;
  for (let t = 0; t < ticks; t++) {
    if (sim.traffic.count > peak) peak = sim.traffic.count;
    if (sim.cohorts.hi > peakHi) peakHi = sim.cohorts.hi;
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

  if (s.cohortTerminal) {
    const co = sim.cohorts;
    console.log(`  cohorts ${co.generated} generated, ${co.boarded} boarded, ${co.missed} missed, ${co.active} active, peak hi ${peakHi}`);
    if (co.generated === 0) cohortFailures.push(s.name);
  }
  peakCounts[s.name] = peak;
  peaks[s.name] = `peak ${peak} aircraft, ${sim.traffic.completedFlights} flights completed, ${sim.traffic.deadlocks} deadlocks${s.bigTerminal ? `, terminal ${(sim.business.terminals[0]?.cells ?? 0) * 4} m2` : ''}`;
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
    console.log(`\nScenario ${s.name}: ${s.stands} stands, ${s.perHour} flights per hour, ${s.ticks ?? TICKS} ticks, budget ${s.budgetMsPerTick} ms/tick`);
    console.log(`  ${peaks[s.name]}`);
    console.log('  subsystem      mean ms     p99 ms');
    for (const [name, stat] of Object.entries(r)) {
      console.log(`  ${name.padEnd(12)} ${stat.mean.toFixed(5).padStart(9)} ${stat.p99.toFixed(5).padStart(10)}`);
    }
    if (s.minPeak !== undefined && peakCounts[s.name] < s.minPeak) {
      console.error(`  PEAK TOO LOW: ${peakCounts[s.name]} aircraft, the scenario must reach ${s.minPeak}`);
      failed = true;
    }
    if (cohortFailures.includes(s.name)) {
      console.error(`  NO COHORTS: ${s.name} generated no cohorts through its terminal`);
      failed = true;
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
