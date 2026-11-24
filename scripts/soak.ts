/**
 * MVP 1 soak test (T38). Builds a medium airport through commands (runway, parallel taxiway, twelve stands, a depot with
 * roads, a fire station, a terminal with the full departure flow and an ATC tower, a staff center), signs the opening
 * airlines and places their series, then runs the equivalent of 3 real hours at 4x: 432 000 ticks.
 *
 * Every game day the state is saved, restored into a fresh sim and compared by hash, and the run goes on with the restored
 * sim, so a save or restore fault cannot hide. Events are answered with their first choice on even days and left to the
 * fallback on odd days. The run fails on a thrown error, a hash mismatch after a restore, a cash value that is not finite,
 * no completed flight, or a p99 tick above the medium budget. It prints a per day table and the timing at the end.
 *
 * Run with `npm run soak`, or `npm run soak -- <ticks>` for a shorter run.
 */
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY } from '../src/shared/business';
import { buildTestAirport, buildTestStaffCenter, buildTestTerminal, OPTIONS, run } from '../tests/helpers';

const TICKS = Number(process.argv[2] ?? 432_000);
/** The medium budget of docs/PERFORMANCE.md, ms per tick at p99. */
const BUDGET_MS = 4;
const SEED = 'SOAK-0001';
/** Minutes tried after a series' window start when placing it, in steps of 15. */
const PLACE_STEPS = 12;

function fail(message: string): never {
  console.error(`SOAK FAILED: ${message}`);
  process.exit(1);
}

function build(): Sim {
  const sim = new Sim(SEED, OPTIONS);
  sim.parcelOwner.fill(1);
  buildTestAirport(sim, { standsPerRow: 12 });
  const problems = [...buildTestTerminal(sim), ...buildTestStaffCenter(sim)];
  // Notices that only report state (a fuel order, an approach) are not build problems.
  const real = problems.filter((p) => !p.includes('|') || p.startsWith('insufficient'));
  if (real.length > 0) fail(`airport build: ${real.join(', ')}`);
  for (let i = 0; i < 3; i++) run(sim, { type: 'signAirline', airlineId: i, sign: true });
  return sim;
}

/** Places every unplaced series of a signed airline on the first stand and minute the sim accepts, as a player would. */
function placeSeries(sim: Sim): number {
  let placed = 0;
  const stands = sim.airfield.data.stands;
  for (const s of sim.business.market.series) {
    if (s.standId >= 0 || !sim.business.airlines[s.airline]?.signed) continue;
    let done = false;
    for (let k = 0; k < PLACE_STEPS && !done; k++) {
      for (let j = 0; j < stands.length && !done; j++) {
        const minute = (s.winMin + 15 * k) % 1440;
        run(sim, { type: 'placeSeries', seriesId: s.id, standId: stands[j]!.id, minute });
        done = s.standId >= 0;
      }
    }
    if (done) placed++;
  }
  return placed;
}

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

function main(): void {
  let sim = build();
  const times = new Float64Array(TICKS);
  let restores = 0;
  let placedTotal = placeSeries(sim);
  let eventsSeen = 0;
  let lastSeq = 0;
  console.log(`soak: ${TICKS} ticks from seed ${SEED}, ${sim.airfield.data.stands.length} stands, ${placedTotal} series placed at start`);
  console.log('  day  completed  deadlocks  pax today  rating        cash  events');
  for (let t = 0; t < TICKS; t++) {
    const view = sim.director.view(sim.tick);
    if (view && view.seq !== lastSeq) {
      lastSeq = view.seq;
      eventsSeen++;
      const c = view.choices[0]!;
      if (Math.floor(sim.tick / TICKS_PER_DAY) % 2 === 0) run(sim, { type: 'eventChoice', seq: view.seq, choice: c.cost <= sim.cash ? c.id : view.fallback });
    }
    const t0 = performance.now();
    try {
      sim.step();
    } catch (e) {
      fail(`tick ${sim.tick}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
    times[t] = performance.now() - t0;
    const drained: string[] = [];
    sim.drainEvents(drained);
    if (!Number.isFinite(sim.cash)) fail(`cash is ${sim.cash} at tick ${sim.tick}`);
    if (sim.tick % TICKS_PER_DAY === 0) {
      placedTotal += placeSeries(sim);
      const tr = sim.traffic;
      console.log(
        `  ${String(Math.floor(sim.tick / TICKS_PER_DAY)).padStart(3)}  ${String(tr.completedFlights).padStart(9)}  ${String(tr.deadlocks).padStart(9)}  ${String(sim.business.paxToday).padStart(9)}  ${sim.business.rating.toFixed(1).padStart(6)}  ${Math.round(sim.cash).toString().padStart(10)}  ${String(eventsSeen).padStart(6)}`,
      );
      const hash = sim.stateHash();
      const data: unknown = JSON.parse(JSON.stringify(sim.serialize()));
      const copy = new Sim(SEED, OPTIONS);
      copy.restore(data);
      if (copy.stateHash() !== hash) fail(`hash changed through a save and restore on day ${Math.floor(sim.tick / TICKS_PER_DAY)}`);
      sim = copy;
      restores++;
    }
  }
  const sorted = Float64Array.from(times).sort();
  let sum = 0;
  for (const v of times) sum += v;
  const p99 = percentile(sorted, 0.99);
  console.log(`\nsoak: ${TICKS} ticks, ${restores} saves restored with equal hashes, ${placedTotal} series placed, ${eventsSeen} events`);
  console.log(`  completed flights ${sim.traffic.completedFlights}, deadlocks ${sim.traffic.deadlocks}, cash ${Math.round(sim.cash)}, rating ${sim.business.rating.toFixed(1)}`);
  console.log('  tick ms     mean      p99      max');
  console.log(`  total   ${(sum / TICKS).toFixed(5).padStart(8)} ${p99.toFixed(5).padStart(8)} ${sorted[sorted.length - 1]!.toFixed(3).padStart(8)}`);
  if (sim.traffic.completedFlights === 0) fail('no flight completed');
  if (p99 > BUDGET_MS) fail(`p99 ${p99.toFixed(3)} ms is above the ${BUDGET_MS} ms medium budget`);
  console.log('soak: passed');
}

main();
