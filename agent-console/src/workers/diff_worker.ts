import { SafeAny } from "../core/escape_hatch";

type KeyPath = (string | number)[];

interface DiffResult {
  added: KeyPath[];
  removed: KeyPath[];
  modified: KeyPath[];
}

function compute_diff(old_val: SafeAny, new_val: SafeAny): DiffResult {
  const added: KeyPath[] = [];
  const removed: KeyPath[] = [];
  const modified: KeyPath[] = [];
  const path_stack: (string | number)[] = [];

  function walk(old_item: SafeAny, new_item: SafeAny) {
    if (old_item === new_item) return;

    const old_type = typeof old_item;
    const new_type = typeof new_item;

    if (old_type !== new_type || old_item === null || new_item === null) {
      modified.push([...path_stack]);
      return;
    }

    if (Array.isArray(old_item) && Array.isArray(new_item)) {
      const max_len = Math.max(old_item.length, new_item.length);
      for (let i = 0; i < max_len; i++) {
        if (i < old_item.length && i < new_item.length && old_item[i] === new_item[i]) {
          continue;
        }
        path_stack.push(i);
        if (i >= old_item.length) {
          added.push([...path_stack]);
        } else if (i >= new_item.length) {
          removed.push([...path_stack]);
        } else {
          walk(old_item[i], new_item[i]);
        }
        path_stack.pop();
      }
      return;
    }

    if (old_type === "object" && new_type === "object") {
      const old_keys = Object.keys(old_item);
      const new_keys = Object.keys(new_item);

      for (let i = 0; i < old_keys.length; i++) {
        const key = old_keys[i];
        if (old_item[key] === new_item[key]) continue;

        path_stack.push(key);
        if (!(key in new_item)) {
          removed.push([...path_stack]);
        } else {
          walk(old_item[key], new_item[key]);
        }
        path_stack.pop();
      }

      for (let i = 0; i < new_keys.length; i++) {
        const key = new_keys[i];
        if (!(key in old_item)) {
          path_stack.push(key);
          added.push([...path_stack]);
          path_stack.pop();
        }
      }
      return;
    }

    modified.push([...path_stack]);
  }

  walk(old_val, new_val);
  return { added, removed, modified };
}

self.onmessage = (event: MessageEvent) => {
  const { old_val, new_val, context_id, snapshot_index } = event.data;
  const result = compute_diff(old_val, new_val);
  self.postMessage({ result, context_id, snapshot_index });
};
