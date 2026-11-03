import type { FromBakeMessage, ToBakeMessage } from '@shared/protocol';
import { chunkPixelSize } from '../chunks';
import { TerrainBaker } from '../terrain';

interface BakeScope {
  postMessage(message: FromBakeMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToBakeMessage>) => void) | null;
}

const scope = self as unknown as BakeScope;
let terrain: TerrainBaker | null = null;

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'site') {
    terrain = new TerrainBaker(msg.site);
    return;
  }
  try {
    if (!terrain) throw new Error('bake requested before the site arrived');
    const px = chunkPixelSize(msg.band);
    const canvas = new OffscreenCanvas(px, px);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.putImageData(terrain.bake(msg.band, msg.cx, msg.cy), 0, 0);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ type: 'baked', key: msg.key, bitmap }, [bitmap]);
  } catch (err) {
    scope.postMessage({ type: 'error', key: msg.key, message: String(err) }, []);
  }
};
