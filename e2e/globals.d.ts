interface E2ECamera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  worldToScreen(wx: number, wy: number, out: { x: number; y: number }): void;
}

interface E2EGame {
  airfield: { runways: unknown[]; taxiways: unknown[]; aprons: unknown[]; stands: unknown[]; holding: unknown[] };
  cash: number;
  tick: number;
  screen: string;
  business: { today: number[]; terminals: unknown[]; rating: number; paxToday: number; history: number[][]; airlines: { rotations: number }[]; board: unknown[]; day: number } | null;
  site: { parcelCount: number; corridor: { cx: number; cy: number } } | null;
}

interface Window {
  __renderer?: { camera: E2ECamera; chunkCount: number } | null;
  __store?: { getState(): E2EGame };
  __send?: (cmd: unknown) => void;
}
