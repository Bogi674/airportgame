import { FIXTURE_KEYS, TERMINAL_GRID, WALL, ZONE, type TerminalGrid } from './business';

const N = TERMINAL_GRID;
const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;
const SEATING = FIXTURE_KEYS.indexOf('seating') + 1;

/** Walls and glass block people, doors and open edges let them through. */
const passable = (type: number): boolean => type === WALL.None || type === WALL.Door;

/** True when a person can step from cell (x, y) to its neighbour in direction d (0 left, 1 right, 2 up, 3 down). */
function canStep(g: TerminalGrid, x: number, y: number, d: number): boolean {
  if (d === 0) return x > 0 && passable(g.vWall[y * (N + 1) + x]) && g.floor[y * N + x - 1] > 0;
  if (d === 1) return x < N - 1 && passable(g.vWall[y * (N + 1) + x + 1]) && g.floor[y * N + x + 1] > 0;
  if (d === 2) return y > 0 && passable(g.hWall[y * N + x]) && g.floor[(y - 1) * N + x] > 0;
  return y < N - 1 && passable(g.hWall[(y + 1) * N + x]) && g.floor[(y + 1) * N + x] > 0;
}

const DX = [-1, 1, 0, 0];
const DY = [0, 0, -1, 1];

/**
 * Checks that passengers can really get through a building. They walk from the check in desks through
 * the public hall to a security lane, and only through a lane into a secure zone with seating. Staff
 * only floor is closed to passengers. Returns issue keys, empty when the building works. The walls,
 * doors and zones the player laid decide the result, so a layout is judged by how it is built.
 */
export function terminalIssues(g: TerminalGrid): string[] {
  const issues: string[] = [];
  let hasCheckIn = false;
  let hasSecurity = false;
  for (let i = 0; i < g.fixture.length; i++) {
    if (g.fixture[i] === CHECK_IN) hasCheckIn = true;
    else if (g.fixture[i] === SECURITY) hasSecurity = true;
  }
  if (!hasCheckIn || !hasSecurity) return issues;

  const seen = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  let head = 0;
  let tail = 0;
  const lanes: number[] = [];
  let touchesLane = false;
  let bypass = false;
  // Landside: from the check in desks over public and unzoned floor, never over lanes or secure floor.
  for (let i = 0; i < g.fixture.length; i++) {
    if (g.fixture[i] === CHECK_IN && seen[i] === 0) {
      seen[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % N;
    const y = (i - x) / N;
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, x, y, d)) continue;
      const j = (y + DY[d]) * N + x + DX[d];
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
  const air = new Uint8Array(N * N);
  head = 0;
  tail = 0;
  for (let i = 0; i < g.fixture.length; i++) {
    if (g.fixture[i] === SECURITY) {
      air[i] = 1;
      queue[tail++] = i;
    }
  }
  let seats = false;
  while (head < tail) {
    const i = queue[head++];
    const x = i % N;
    const y = (i - x) / N;
    for (let d = 0; d < 4; d++) {
      if (!canStep(g, x, y, d)) continue;
      const j = (y + DY[d]) * N + x + DX[d];
      if (air[j] === 1 || g.zone[j] !== ZONE.Secure) continue;
      air[j] = 1;
      queue[tail++] = j;
      if (g.fixture[j] === SEATING) seats = true;
    }
  }
  if (!seats) issues.push('noSeatingLink');
  return issues;
}
