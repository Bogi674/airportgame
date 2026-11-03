interface E2ECamera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  worldToScreen(wx: number, wy: number, out: { x: number; y: number }): void;
}

interface E2EAirfield {
  runways: unknown[];
  taxiways: unknown[];
  aprons: unknown[];
  stands: unknown[];
  holding: unknown[];
}

interface Window {
  __renderer?: { camera: E2ECamera; chunkCount: number } | null;
  __store?: { getState(): { airfield: E2EAirfield; cash: number } };
}
