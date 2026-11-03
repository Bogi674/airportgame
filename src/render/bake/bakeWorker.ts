import type { FromBakeMessage, ToBakeMessage } from '@shared/protocol';
import { chunkPixelSize } from '../chunks';
import { bakeChunkPlaceholder } from './bakeChunk';

interface BakeScope {
  postMessage(message: FromBakeMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToBakeMessage>) => void) | null;
}

const scope = self as unknown as BakeScope;

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type !== 'bake') return;
  try {
    const px = chunkPixelSize(msg.band);
    const canvas = new OffscreenCanvas(px, px);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    bakeChunkPlaceholder(ctx, msg.band, msg.cx, msg.cy);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ type: 'baked', key: msg.key, bitmap }, [bitmap]);
  } catch (err) {
    scope.postMessage({ type: 'error', key: msg.key, message: String(err) }, []);
  }
};
