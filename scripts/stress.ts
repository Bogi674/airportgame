/**
 * Headless benchmark. Builds the small, medium and large scenarios from fixed seeds,
 * runs 20 000 ticks and prints mean and p99 ms per tick per subsystem.
 * Fails on a budget breach or a regression above 10 percent against perf-baseline.json.
 * Use `--update-baseline` to rewrite the baseline after a reviewed, intended change.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sim } from '../src/sim/sim';
import { AIRCRAFT } from '../src/data/aircraft';
import { createSnapshotBuffer, createSnapshotViews } from '../src/shared/snapshot';
import { buildTestAirport } from '../tests/helpers';
import { buildWalkGraph, updateWalkGraph, type WalkGraph } from '../src/sim/terminal/walkGraph';
import { originFor, type TerminalEdit } from '../src/shared/terminalOps';
import { STAFF_STATE } from '../src/sim/staff/staff';

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
  /** Adds a 120 by 30 cell terminal with 24 check in desks, 12 security lanes, 16 gate desks, seating, toilets and every shop kind. */
  peopleTerminal?: boolean;
  /** Live cohorts and active people the scenario must reach at once at some point. */
  minCohorts?: number;
  minPeople?: number;
  /** Test arrivals queued at the start, so many flights hold cohorts at once. The airport cannot park that many aircraft, so most of their passengers wait or miss. */
  arrivals?: { type: string; count: number; gapTicks: number; turnTicks: number };
}

const SCENARIOS: Scenario[] = [
  { name: 'small', seed: 'STRESS-SMALL', stands: 8, perHour: 40, budgetMsPerTick: 1 },
  { name: 'medium', seed: 'STRESS-MEDIUM', stands: 20, perHour: 120, budgetMsPerTick: 4, cohortTerminal: true },
  { name: 'large', seed: 'STRESS-LARGE', stands: 30, perHour: 240, budgetMsPerTick: 8 },
  { name: 'busy50', seed: 'STRESS-BUSY', stands: 60, standCode: 'B', perHour: 720, budgetMsPerTick: 4, turnScale: 16, ticks: 60_000, minPeak: 50 },
  { name: 'terminal640', seed: 'STRESS-TERMINAL', stands: 20, perHour: 120, budgetMsPerTick: 4, bigTerminal: true },
  { name: 'people20k', seed: 'STRESS-PEOPLE', stands: 30, perHour: 240, budgetMsPerTick: 4, peopleTerminal: true, minCohorts: 20_000, minPeople: 40_000, arrivals: { type: 'b777_300er', count: 200, gapTicks: 30, turnTicks: 14_000 } },
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
  edit(id, { op: 'zone', x0: 172, y0: 40, x1: 360, y1: 100, variant: 3 });
  // The secure hall is closed by a wall at x = 172 with two gaps: 20 security lanes flowing east, and a security exit flowing west.
  edit(id, { op: 'wall', x0: 172, y0: 40, x1: 172, y1: 60, variant: 1 });
  edit(id, { op: 'wall', x0: 172, y0: 80, x1: 172, y1: 90, variant: 1 });
  edit(id, { op: 'wall', x0: 172, y0: 92, x1: 172, y1: 100, variant: 1 });
  edit(id, { op: 'fixture', x0: 172, y0: 60, x1: 173, y1: 80, variant: 2, rot: 1 });
  edit(id, { op: 'fixture', x0: 172, y0: 91, x1: 173, y1: 92, variant: 20, rot: 3, level: 1 });
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
  // The wall leaves a gap at rows 50 and 51 for the security exit, which flows west from the secure hall.
  edit(id, { op: 'wall', x0: 72, y0: 48, x1: 72, y1: 50, variant: 1 });
  edit(id, { op: 'fixture', x0: 42, y0: 42, x1: 54, y1: 43, variant: 1 });
  edit(id, { op: 'fixture', x0: 72, y0: 42, x1: 73, y1: 48, variant: 2, rot: 1 });
  edit(id, { op: 'fixture', x0: 72, y0: 51, x1: 73, y1: 52, variant: 20, rot: 3, level: 1 });
  edit(id, { op: 'fixture', x0: 76, y0: 44, x1: 84, y1: 45, variant: 16 });
  edit(id, { op: 'fixture', x0: 76, y0: 46, x1: 82, y1: 47, variant: 4 });
  if (sim.business.cohortGrid(0) < 0) throw new Error('cohort terminal has no eligible grid');
}

/**
 * A 120 by 30 cell terminal at the cohort terminal origin: a public hall with a curb door and 24 check in desks, a secure
 * hall behind a wall with 12 security lanes and a security exit, and in the secure hall 16 gate desks, seating, toilets
 * and one of each shop kind in a commercial area. Departing cohorts walk through every service point and visit the shops.
 */
function buildPeopleTerminal(sim: Sim): void {
  const { ox, oy } = originFor(3200, 5600, 90);
  const edit = (building: number, e: TerminalEdit): void => {
    sim.enqueue({ type: 'terminalBuild', building, ox, oy, headingDeg: 90, edit: e });
    sim.step();
  };
  edit(-1, { op: 'foundation', x0: 40, y0: 40, x1: 160, y1: 70, variant: 0 });
  const id = sim.business.grids[sim.business.grids.length - 1]?.id ?? -1;
  if (id < 0) throw new Error('people terminal was not built');
  edit(id, { op: 'floor', x0: 40, y0: 40, x1: 160, y1: 70, variant: 2 });
  edit(id, { op: 'wall', x0: 40, y0: 40, x1: 160, y1: 40, variant: 1 });
  edit(id, { op: 'wall', x0: 40, y0: 70, x1: 160, y1: 70, variant: 1 });
  edit(id, { op: 'wall', x0: 70, y0: 70, x1: 72, y1: 70, variant: 3 });
  // The curb door needs floor on both sides, so the strip outside the door is floor too.
  edit(id, { op: 'foundation', x0: 68, y0: 70, x1: 74, y1: 71, variant: 0 });
  edit(id, { op: 'floor', x0: 68, y0: 70, x1: 74, y1: 71, variant: 2 });
  // The secure hall east of x = 72, closed by a wall with a 12 lane opening and a two cell gap for the security exit.
  edit(id, { op: 'zone', x0: 72, y0: 40, x1: 160, y1: 70, variant: 3 });
  edit(id, { op: 'wall', x0: 72, y0: 40, x1: 72, y1: 42, variant: 1 });
  edit(id, { op: 'wall', x0: 72, y0: 54, x1: 72, y1: 56, variant: 1 });
  edit(id, { op: 'wall', x0: 72, y0: 58, x1: 72, y1: 70, variant: 1 });
  edit(id, { op: 'fixture', x0: 42, y0: 42, x1: 66, y1: 43, variant: 1 });
  edit(id, { op: 'fixture', x0: 72, y0: 42, x1: 73, y1: 54, variant: 2, rot: 1 });
  edit(id, { op: 'fixture', x0: 72, y0: 57, x1: 73, y1: 58, variant: 20, rot: 3, level: 1 });
  edit(id, { op: 'fixture', x0: 76, y0: 44, x1: 92, y1: 45, variant: 16 });
  edit(id, { op: 'fixture', x0: 76, y0: 48, x1: 124, y1: 49, variant: 4 });
  edit(id, { op: 'fixture', x0: 76, y0: 52, x1: 88, y1: 53, variant: 5 });
  edit(id, { op: 'zone', x0: 100, y0: 56, x1: 112, y1: 58, variant: 2 });
  for (let k = 0; k < 6; k++) edit(id, { op: 'fixture', x0: 100 + 2 * k, y0: 56, x1: 101 + 2 * k, y1: 57, variant: 6 + k });
  if (sim.business.cohortGrid(0) < 0) throw new Error('people terminal has no eligible grid');
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
/** Peak live cohorts and active people of the scenarios with a people terminal. */
const peopleReport: Record<string, { cohorts: number; people: number }> = {};

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
  if (s.peopleTerminal) buildPeopleTerminal(sim);
  if (s.arrivals) {
    const type = AIRCRAFT.findIndex((a) => a.id === s.arrivals!.type);
    if (type < 0) throw new Error(`unknown aircraft ${s.arrivals.type}`);
    for (let k = 0; k < s.arrivals.count; k++) {
      sim.enqueue({ type: 'testArrival', typeIdx: type, inTicks: 50 + k * s.arrivals.gapTicks, turnTicks: s.arrivals.turnTicks });
    }
  }
  // A level 5 tower keeps the benchmark measuring traffic, not ATC starvation (task T40 R4).
  sim.enqueue({ type: 'buildTower', x: 2700, y: 4800, level: 5 });
  sim.enqueue({ type: 'setTestTraffic', perHour: s.perHour, turnScale: s.turnScale ?? 0.36 });
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
  let peakLive = 0;
  let peakPeople = 0;
  let peakArr = 0;
  let peakHired = 0;
  let peakOnDuty = 0;
  const hasTerminal = Boolean(s.bigTerminal || s.cohortTerminal || s.peopleTerminal);
  const views = createSnapshotViews(createSnapshotBuffer());
  let snapNs = 0n;
  let snapCount = 0;
  for (let t = 0; t < ticks; t++) {
    if (sim.traffic.count > peak) peak = sim.traffic.count;
    if (sim.cohorts.hi > peakHi) peakHi = sim.cohorts.hi;
    // Counted outside the timed section, and only every 500 ticks, as it scans every slot.
    if ((s.peopleTerminal || s.cohortTerminal) && t % 500 === 0) {
      if (sim.cohorts.arrActive > peakArr) peakArr = sim.cohorts.arrActive;
    }
    if (s.peopleTerminal && t % 500 === 0) {
      let live = 0;
      for (let c = 0; c < sim.cohorts.hi; c++) if (sim.cohorts.stage[c] !== 0) live++;
      if (live > peakLive) peakLive = live;
      if (sim.cohorts.active > peakPeople) peakPeople = sim.cohorts.active;
    }
    // Staff are counted outside the timed section too, every 500 ticks.
    if (hasTerminal && t % 500 === 0) {
      const st = sim.staff;
      const hired = st.hired(0) + st.hired(1) + st.hired(2);
      if (hired > peakHired) peakHired = hired;
      let onDuty = 0;
      for (let m = 0; m < st.hi; m++) if (st.state[m] === STAFF_STATE.OnDuty) onDuty++;
      if (onDuty > peakOnDuty) peakOnDuty = onDuty;
    }
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
    if (t % 10 === 0) {
      const t0 = process.hrtime.bigint();
      sim.writeSnapshot(views);
      snapNs += process.hrtime.bigint() - t0;
      snapCount++;
    }
  }
  console.log(`  snapshot ${(Number(snapNs) / 1e6 / snapCount).toFixed(3)} ms mean over ${snapCount} writes (info, not budgeted)`);

  if (s.cohortTerminal || s.peopleTerminal) {
    const co = sim.cohorts;
    console.log(`  cohorts ${co.generated} generated, ${co.boarded} boarded, ${co.missed} missed, ${co.active} active, peak hi ${peakHi}`);
    if (co.generated === 0) cohortFailures.push(s.name);
    console.log(`  arrivals peak ${peakArr} people, exited ${co.arrExited}, stranded ${co.arrStranded}`);
  }
  if (s.peopleTerminal) {
    console.log(`  people peak ${peakLive} cohorts, ${peakPeople} people`);
    peopleReport[s.name] = { cohorts: peakLive, people: peakPeople };
  }
  if (hasTerminal) console.log(`  staff peak ${peakHired} hired, ${peakOnDuty} on duty`);
  peakCounts[s.name] = peak;
  peaks[s.name] = `peak ${peak} aircraft, ${sim.traffic.completedFlights} flights completed, ${sim.traffic.divertedFlights} diverted, ${sim.traffic.deadlocks} deadlocks${s.bigTerminal ? `, terminal ${(sim.business.terminals[0]?.cells ?? 0) * 4} m2` : ''}`;
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
    const people = peopleReport[s.name];
    if (people && ((s.minCohorts !== undefined && people.cohorts < s.minCohorts) || (s.minPeople !== undefined && people.people < s.minPeople))) {
      console.error(`  PEOPLE TOO LOW: ${people.cohorts} cohorts and ${people.people} people, the scenario must reach ${s.minCohorts ?? 0} and ${s.minPeople ?? 0}`);
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
