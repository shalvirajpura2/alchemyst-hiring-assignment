import { SafeAny } from "../core/escape_hatch";

export type KeyPath = (string | number)[];

export interface DiffResult {
  added: KeyPath[];
  removed: KeyPath[];
  modified: KeyPath[];
}

let worker_instance: Worker | null = null;
const pending_resolves = new Map<
  string,
  (value: DiffResult | PromiseLike<DiffResult>) => void
>();

function get_worker(): Worker | null {
  if (typeof window === "undefined") {
    return null;
  }
  
  if (!worker_instance) {
    // Next.js standard Web Worker syntax
    worker_instance = new Worker(new URL("../workers/diff_worker.ts", import.meta.url));
    
    worker_instance.onmessage = (event) => {
      const { result, context_id, snapshot_index } = event.data;
      const key = `${context_id}_${snapshot_index}`;
      const resolve = pending_resolves.get(key);
      if (resolve) {
        resolve(result);
        pending_resolves.delete(key);
      }
    };
  }
  
  return worker_instance;
}

export function request_json_diff(
  old_val: SafeAny,
  new_val: SafeAny,
  context_id: string,
  snapshot_index: number
): Promise<DiffResult> {
  const worker = get_worker();
  if (!worker) {
    return Promise.resolve({ added: [], removed: [], modified: [] });
  }

  const key = `${context_id}_${snapshot_index}`;
  return new Promise<DiffResult>((resolve) => {
    pending_resolves.set(key, resolve);
    worker.postMessage({ old_val, new_val, context_id, snapshot_index });
  });
}
