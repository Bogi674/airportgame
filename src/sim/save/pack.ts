/** Typed arrays travel inside JSON saves as base64 text. */

const CHUNK = 0x8000;

export function packTyped(a: ArrayBufferView): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

type Ctor<T> = { new (buffer: ArrayBuffer): T; BYTES_PER_ELEMENT: number };

export function unpackTyped<T extends ArrayBufferView>(text: string, ctor: Ctor<T>): T {
  const bin = atob(text);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new ctor(buf);
}

/** Copies a packed array into an existing typed array of the same type, keeping its length. */
export function unpackInto<T extends ArrayBufferView & { length: number; set(src: ArrayLike<number>): void }>(
  text: string,
  target: T,
  ctor: Ctor<T>,
): void {
  const src = unpackTyped(text, ctor) as unknown as ArrayLike<number>;
  target.set(src.length > target.length ? Array.prototype.slice.call(src, 0, target.length) : src);
}
