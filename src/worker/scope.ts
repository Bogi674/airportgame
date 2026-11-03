/** Minimal typing for a dedicated worker global, so the DOM lib and worker code can share one tsconfig. */
export interface WorkerScope<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<In>) => void) | null;
}
