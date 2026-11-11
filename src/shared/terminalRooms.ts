import { FIXTURE_KEYS, WALL, ZONE, type TerminalGrid } from './business';

const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const KIOSK = FIXTURE_KEYS.indexOf('kiosk') + 1;
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;
const SEATING = FIXTURE_KEYS.indexOf('seating') + 1;
const GATE_DESK = FIXTURE_KEYS.indexOf('gateDesk') + 1;
/** fixtureRot of the tail cell of a two cell fixture is 5 to 8. Only anchors (0 to 4) decide reach. */
const TAIL_ROT = 5;

/** Walls and glass block people, doors and open edges let them through. */
const passable = (type: number): boolean => type === WALL.None || type === WALL.Door;

/**
 * True when a person can step from array cell (x, y) to its neighbour in direction d (0 left, 1 right,
 * 2 up, 3 down). Works in array coordinates of the building's grid.
 */
function canStep(g: TerminalGrid, x: number, y: number, d: number): boolean {
  const W = g.w;
  if (d === 0) return x > 0 && passable(g.vWall[y * (W + 1) + x]) && g.floor[y * W + x - 1] > 0;
  if (d === 1) return x < W - 1 && passable(g.vWall[y * (W + 1) + x + 1]) && g.floor[y * W + x + 1] > 0;
  if (d === 2) return y > 0 && passable(g.hWall[y * W + x]) && g.floor[(y - 1) * W + x] > 0;
  return y < g.h - 1 && passable(g.hWall[(y + 1) * W + x]) && g.floor[(y + 1) * W + x] > 0;
}

const DX = [-1, 1, 0, 0];
const DY = [0, 0, -1, 1];

/**
 * Checks that passengers can really get through a building. They walk from the check in desks through
 * the public hall to a security lane, and only through a lane into a secure zone with seating. Staff
 * only floor is closed to passengers. Returns issue keys, empty when the building works. The walls,
 * doors and zones the player laid decide the result, so a layout is judged by how it is built.
 * Check in desks and kiosks are the landside sources. A gate desk must be reachable from a lane.
 */
export function terminalIssues(g: TerminalGrid): string[] {
  const issues: string[] = [];
  let hasSource = false;
  let hasSecurity = false;
  let hasGateDesk = false;
  for (let i = 0; i < g.fixture.length; i++) {
    if (g.fixture[i] === CHECK_IN || g.fixture[i] === KIOSK) hasSource = true;
    else if (g.fixture[i] === SECURITY) hasSecurity = true;
    else if (g.fixture[i] === GATE_DESK && g.fixtureRot[i] < TAIL_ROT) hasGateDesk = true;
  }
  if (!hasSource || !hasSecurity) return issues;

  const W = g.w;
  const seen = new Uint8Array(g.w * g.h);
  const queue = new Int32Array(g.w * g.h);
  let head = 0;
  let tail = 0;
  const lanes: number[] = [];
  let touchesLane = false;
  let bypass = false;
  // Landside: from the check in desks and kiosks over public and unzoned floor, never over lanes or secure floor.
  for (let i = 0; i < g.fixture.length; i++) {
    if ((g.fixture[i] === CHECK_IN || g.fixture[i] === KIOSK) && seen[i] === 0) {
      seen[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, x, y, d)) continue;
      const j = (y + DY[d]) * W + x + DX[d];
      if (g.fixture[j] === SECURITY) {
        touchesLane = true;
        if (!lanes.includes(j)) lanes.push(j);
        continue;
      }
      if (seen[j] === 1) continue;
      const z = g.zone[j];
      if (z === ZONE.Secure) {
        bypass = true;
        continue;
      }
      if (z === ZONE.Staff) continue;
      seen[j] = 1;
      queue[tail++] = j;
    }
  }
  if (!touchesLane) issues.push('noSecurityLink');
  if (bypass) issues.push('securityBypass');

  // Airside: from the lanes into secure floor, looking for seats.
  const air = new Uint8Array(g.w * g.h);
  head = 0;
  tail = 0;
  for (let i = 0; i < g.fixture.length; i++) {
    if (g.fixture[i] === SECURITY) {
      air[i] = 1;
      queue[tail++] = i;
    }
  }
  let seats = false;
  let gateReached = false;
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, x, y, d)) continue;
      const j = (y + DY[d]) * W + x + DX[d];
      if (air[j] === 1 || g.zone[j] !== ZONE.Secure) continue;
      air[j] = 1;
      queue[tail++] = j;
      if (g.fixture[j] === SEATING) seats = true;
      if (g.fixture[j] === GATE_DESK && g.fixtureRot[j] < TAIL_ROT) gateReached = true;
    }
  }
  if (!seats) issues.push('noSeatingLink');
  if (hasGateDesk && !gateReached) issues.push('noGateDeskLink');
  return issues;
}
