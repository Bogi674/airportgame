import type { Command } from '@sim/commands';
import type { Preset, SitePayload } from './site';
import type { Speed } from './time';

/** Options chosen in the new game wizard. Grows with later milestones. */
export interface GameOptions {
  preset: Preset;
}

/** Parcel ownership and cash, sent whenever either changes. */
export interface OwnershipPayload {
  owner: Uint8Array;
  cash: number;
}

export const PROTOCOL_VERSION = 1;

/** Main thread to sim worker. */
export type ToSimMessage =
  | { type: 'init'; seed: string; options: GameOptions }
  | { type: 'commands'; list: Command[] }
  | { type: 'setSpeed'; multiplier: Speed }
  | { type: 'query'; id: number; kind: string; args: unknown }
  | { type: 'returnBuffer'; buffer: ArrayBuffer };

export interface PerfReport {
  simMsPerTick: number;
  tickBacklog: number;
  aircraftCount: number;
}

/** Sim worker to main thread. */
export type FromSimMessage =
  | { type: 'ready' }
  | { type: 'snapshot'; tick: number; buffer: ArrayBuffer }
  | { type: 'staticDirty'; chunks: number[]; kinds: number[] }
  | { type: 'staticData'; kind: 'site'; payload: SitePayload }
  | { type: 'staticData'; kind: 'ownership'; payload: OwnershipPayload }
  | { type: 'queryResult'; id: number; data: unknown }
  | { type: 'events'; list: string[] }
  | { type: 'perf'; report: PerfReport }
  | { type: 'error'; tick: number; seed: string; message: string; commands: Command[] };

/** Main thread to bake worker. */
export type ToBakeMessage =
  | { type: 'site'; site: BakeSite }
  | { type: 'bake'; key: number; band: number; cx: number; cy: number };

/** The part of the site the terrain baker needs. */
export interface BakeSite {
  seed: string;
  heights: Float32Array;
  landClass: Uint8Array;
  parcelId: Uint16Array;
}

/** Bake worker to main thread. */
export type FromBakeMessage =
  | { type: 'baked'; key: number; bitmap: ImageBitmap }
  | { type: 'error'; key: number; message: string };
