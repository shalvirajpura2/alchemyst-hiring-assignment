import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AgentEvent } from "../core/event_types";
import { SafeAny } from "../core/escape_hatch";
import { request_json_diff, DiffResult, KeyPath } from "../utils/diff_engine";
import styles from "./ContextInspector.module.css";

interface ContextInspectorProps {
  event_log: AgentEvent[];
}

interface FlattenedNode {
  key_name: string;
  value: SafeAny;
  path: KeyPath;
  path_str: string;
  depth: number;
  is_expandable: boolean;
  is_expanded: boolean;
  diff_type: "added" | "removed" | "modified" | "none";
}

export default function ContextInspector({ event_log }: ContextInspectorProps) {
  // Extract context snapshots
  const context_snapshots = useMemo(() => {
    return event_log.filter((e) => e.type === "CONTEXT_SNAPSHOT") as Extract<
      AgentEvent,
      { type: "CONTEXT_SNAPSHOT" }
    >[];
  }, [event_log]);

  // Group snapshots by context_id
  const snapshots_by_id = useMemo(() => {
    const map = new Map<string, typeof context_snapshots>();
    for (const snap of context_snapshots) {
      const list = map.get(snap.context_id) ?? [];
      list.push(snap);
      map.set(snap.context_id, list);
    }
    return map;
  }, [context_snapshots]);

  // Available context IDs
  const context_ids = useMemo(() => {
    return Array.from(snapshots_by_id.keys());
  }, [snapshots_by_id]);

  const [selected_id, set_selected_id] = useState<string>("");
  const [snapshot_idx, set_snapshot_idx] = useState<number>(0);
  const [diff_result, set_diff_result] = useState<DiffResult | null>(null);
  const [expanded_nodes, set_expanded_nodes] = useState<Record<string, boolean>>({ "": true });
  const [is_loading_diff, set_is_loading_diff] = useState(false);

  // Set default context ID when available
  useEffect(() => {
    if (context_ids.length > 0 && !selected_id) {
      set_selected_id(context_ids[0]);
      set_snapshot_idx(0);
    }
  }, [context_ids, selected_id]);

  const active_snapshots = useMemo(() => {
    return selected_id ? snapshots_by_id.get(selected_id) ?? [] : [];
  }, [selected_id, snapshots_by_id]);

  const current_snapshot = active_snapshots[snapshot_idx];
  const previous_snapshot = snapshot_idx > 0 ? active_snapshots[snapshot_idx - 1] : null;

  // Request diff from web worker when index changes
  useEffect(() => {
    if (!current_snapshot) {
      set_diff_result(null);
      return;
    }

    if (!previous_snapshot) {
      // First snapshot, no diff
      set_diff_result(null);
      return;
    }

    set_is_loading_diff(true);
    request_json_diff(
      previous_snapshot.data,
      current_snapshot.data,
      current_snapshot.context_id,
      snapshot_idx
    )
      .then((res) => {
        set_diff_result(res);
        set_is_loading_diff(false);
      })
      .catch(() => {
        set_is_loading_diff(false);
      });
  }, [current_snapshot, previous_snapshot, snapshot_idx]);

  // Reset indices when context ID changes
  const handle_id_change = (e: React.ChangeEvent<HTMLSelectElement>) => {
    set_selected_id(e.target.value);
    set_snapshot_idx(0);
    set_diff_result(null);
    set_expanded_nodes({ "": true });
  };

  // Check path type from diff results
  const get_path_diff_type = useCallback((path: KeyPath): "added" | "removed" | "modified" | "none" => {
    if (!diff_result) return "none";

    const path_matches = (target: KeyPath, list: KeyPath[]) => {
      return list.some(
        (p) => p.length === target.length && p.every((val, i) => val === target[i])
      );
    };

    if (path_matches(path, diff_result.added)) return "added";
    if (path_matches(path, diff_result.removed)) return "removed";
    if (path_matches(path, diff_result.modified)) return "modified";

    // Also check if parents are modified/changed to color children partially
    const is_descendant_of = (target: KeyPath, list: KeyPath[]) => {
      return list.some(
        (p) => p.length < target.length && p.every((val, i) => val === target[i])
      );
    };

    if (is_descendant_of(path, diff_result.added)) return "added";
    if (is_descendant_of(path, diff_result.removed)) return "removed";
    if (is_descendant_of(path, diff_result.modified)) return "modified";

    return "none";
  }, [diff_result]);

  // Flatten nested JSON for virtualized/lazy rendering
  const flatten_json = useCallback((
    obj: SafeAny,
    current_path: KeyPath = [],
    depth = 0
  ): FlattenedNode[] => {
    if (obj === null || obj === undefined) return [];

    const nodes: FlattenedNode[] = [];
    const keys = Object.keys(obj);

    for (const key of keys) {
      const val = obj[key];
      const is_obj = typeof val === "object" && val !== null;
      const path = [...current_path, key];
      const path_str = path.join(".");
      const is_expanded = !!expanded_nodes[path_str];
      const diff_type = get_path_diff_type(path);

      nodes.push({
        key_name: key,
        value: val,
        path,
        path_str,
        depth,
        is_expandable: is_obj,
        is_expanded,
        diff_type,
      });

      if (is_obj && is_expanded) {
        nodes.push(...flatten_json(val, path, depth + 1));
      }
    }

    return nodes;
  }, [expanded_nodes, get_path_diff_type]);

  const visible_nodes = useMemo(() => {
    if (!current_snapshot) return [];
    return flatten_json(current_snapshot.data);
  }, [current_snapshot, flatten_json]);

  const toggle_node = (path_str: string) => {
    set_expanded_nodes((prev) => ({
      ...prev,
      [path_str]: !prev[path_str],
    }));
  };

  const get_diff_class = (type: string) => {
    switch (type) {
      case "added":
        return styles.node_added;
      case "removed":
        return styles.node_removed;
      case "modified":
        return styles.node_modified;
      default:
        return "";
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title_row}>
          <h3 className={styles.title}>Context Snapshots</h3>
          {context_ids.length > 1 && (
            <select
              value={selected_id}
              onChange={handle_id_change}
              className={styles.id_select}
            >
              {context_ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          )}
        </div>

        {active_snapshots.length > 0 && (
          <div className={styles.scrubber_controls}>
            <div className={styles.btn_group}>
              <button
                disabled={snapshot_idx === 0}
                onClick={() => set_snapshot_idx((prev) => prev - 1)}
                className={styles.scrub_btn}
              >
                ◀ Prev
              </button>
              <span className={styles.scrub_label}>
                Snap {snapshot_idx + 1} of {active_snapshots.length}
              </span>
              <button
                disabled={snapshot_idx === active_snapshots.length - 1}
                onClick={() => set_snapshot_idx((prev) => prev + 1)}
                className={styles.scrub_btn}
              >
                Next ▶
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={active_snapshots.length - 1}
              value={snapshot_idx}
              onChange={(e) => set_snapshot_idx(parseInt(e.target.value))}
              className={styles.slider}
            />
          </div>
        )}
      </div>

      <div className={styles.tree_body}>
        {is_loading_diff && <div className={styles.diff_loading}>Calculating diff off-thread...</div>}
        
        {active_snapshots.length === 0 ? (
          <div className={styles.empty_state}>
            Waiting for CONTEXT_SNAPSHOT events...
          </div>
        ) : (
          <div className={styles.tree_container}>
            <div className={styles.node_row} style={{ paddingLeft: 0 }}>
              <span className={styles.root_bracket}>{"{"}</span>
            </div>
            {visible_nodes.map((node) => (
              <div
                key={node.path_str}
                className={`${styles.node_row} ${get_diff_class(node.diff_type)}`}
                style={{ paddingLeft: `${(node.depth + 1) * 16}px` }}
              >
                {node.is_expandable ? (
                  <span
                    className={styles.toggle_icon}
                    onClick={() => toggle_node(node.path_str)}
                  >
                    {node.is_expanded ? "▼" : "▶"}
                  </span>
                ) : (
                  <span className={styles.bullet_icon}>•</span>
                )}
                
                <span className={styles.key_label}>{node.key_name}</span>
                <span className={styles.colon}>:</span>
                
                {node.is_expandable ? (
                  <span className={styles.bracket}>
                    {Array.isArray(node.value) ? "[" : "{"}
                  </span>
                ) : (
                  <span className={styles.value_label}>
                    {JSON.stringify(node.value)}
                  </span>
                )}
              </div>
            ))}
            <div className={styles.node_row} style={{ paddingLeft: 0 }}>
              <span className={styles.root_bracket}>{"}"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
