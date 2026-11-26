interface E2ECamera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  worldToScreen(wx: number, wy: number, out: { x: number; y: number }): void;
}

interface E2EGame {
  airfield: { runways: { lengthM: number; code: string }[]; taxiways: { points: { x: number; y: number }[] }[]; aprons: unknown[]; stands: unknown[]; holding: unknown[] };
  alertLog: { text: string }[];
  cash: number;
  tick: number;
  screen: string;
  game: { seed: string; mode: string; airport: { name: string; iata: string } };
  business: { today: number[]; terminals: unknown[]; rating: number; paxToday: number; history: number[][]; airlines: { signed: boolean }[]; board: unknown[]; day: number } | null;
  site: { parcelCount: number; corridor: { cx: number; cy: number }; parcelId: Uint16Array; parcelType: Uint8Array } | null;
}

interface Window {
  __renderer?: { camera: E2ECamera; chunkCount: number } | null;
  __store?: { getState(): E2EGame };
  __send?: (cmd: unknown) => void;
}
