import { describe, it, expect } from "vitest";
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

describe("JSON Diff Engine", () => {
  it("should compute structural additions, removals, and modifications correctly", () => {
    const old_json = {
      name: "Alchemyst",
      version: 1,
      tags: ["ai", "observability"],
      settings: {
        theme: "light",
        retries: 3,
      },
    };

    const new_json = {
      name: "Alchemyst",
      version: 2, // modified
      tags: ["ai", "observability", "realtime"], // added "realtime"
      settings: {
        theme: "dark", // modified
        // removed retries
      },
      status: "active", // added key
    };

    const diff = compute_diff(old_json, new_json);

    // Verify added keys
    expect(diff.added).toContainEqual(["status"]);
    expect(diff.added).toContainEqual(["tags", 2]);

    // Verify removed keys
    expect(diff.removed).toContainEqual(["settings", "retries"]);

    // Verify modified keys
    expect(diff.modified).toContainEqual(["version"]);
    expect(diff.modified).toContainEqual(["settings", "theme"]);
  });

  it("should perform under 10ms for large 500KB+ JSON objects", () => {
    // Generate a deep object of ~500KB
    const generate_large_json = () => {
      const obj: Record<string, SafeAny> = {};
      for (let i = 0; i < 5000; i++) {
        obj[`key_${i}`] = {
          id: i,
          title: `Item index ${i}`,
          details: {
            created_at: "2026-06-12",
            tags: ["a", "b", "c"],
            nested: {
              active: true,
              value: Math.random(),
            },
          },
        };
      }
      return obj;
    };

    const old_large = generate_large_json();
    const new_large = JSON.parse(JSON.stringify(old_large));

    // Make some modifications, additions, and deletions
    new_large["key_100"].details.nested.active = false; // modified
    new_large["key_500"].details.tags.push("d"); // added
    delete new_large["key_1000"].details.created_at; // removed
    new_large["added_key_9999"] = { extra: true }; // added

    // Measure time
    const start = performance.now();
    const diff = compute_diff(old_large, new_large);
    const end = performance.now();
    const duration = end - start;

    expect(diff.modified).toContainEqual(["key_100", "details", "nested", "active"]);
    expect(diff.added).toContainEqual(["key_500", "details", "tags", 3]);
    expect(diff.removed).toContainEqual(["key_1000", "details", "created_at"]);
    expect(diff.added).toContainEqual(["added_key_9999"]);

    console.log(`[diff-benchmark] 500KB JSON diff duration: ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(50); // Assert completion in <50ms
  });
});
