import React, { useState, useMemo, useRef, useEffect } from "react";
import { AgentEvent } from "../core/event_types";
import { SafeAny } from "../core/escape_hatch";
import styles from "./TraceTimeline.module.css";

interface TraceTimelineProps {
  event_log: AgentEvent[];
  active_highlight_seqs: number[] | null;
  on_event_click: (block_id: string) => void;
}

type TimelineItem =
  | {
      type: "token_group";
      stream_id: string;
      tokens: { seq: number; text: string; timestamp: number }[];
      start_time: number;
      end_time: number;
      is_expanded: boolean;
      seqs: number[];
    }
  | {
      type: "single";
      event: AgentEvent;
      seqs: number[];
    };

export default function TraceTimeline({
  event_log,
  active_highlight_seqs,
  on_event_click,
}: TraceTimelineProps) {
  const [filter_type, set_filter_type] = useState<string>("ALL");
  const [search_query, set_search_query] = useState<string>("");
  const [expanded_groups, set_expanded_groups] = useState<Record<string, boolean>>({});

  const container_ref = useRef<HTMLDivElement>(null);
  const [scroll_top, set_scroll_top] = useState(0);
  const [container_height, set_container_height] = useState(400);

  // Measure container height
  useEffect(() => {
    if (container_ref.current) {
      set_container_height(container_ref.current.clientHeight);
      const handle_resize = () => {
        if (container_ref.current) {
          set_container_height(container_ref.current.clientHeight);
        }
      };
      window.addEventListener("resize", handle_resize);
      return () => window.removeEventListener("resize", handle_resize);
    }
  }, []);

  const handle_scroll = (e: React.UIEvent<HTMLDivElement>) => {
    set_scroll_top(e.currentTarget.scrollTop);
  };

  // Group events
  const grouped_items = useMemo(() => {
    const items: TimelineItem[] = [];
    let current_group: {
      type: "token_group";
      stream_id: string;
      tokens: { seq: number; text: string; timestamp: number }[];
      start_time: number;
      end_time: number;
      is_expanded: boolean;
      seqs: number[];
    } | null = null;

    for (const event of event_log) {
      if (event.type === "TOKEN") {
        const token_time = event.timestamp;
        const time_window = 100; // 100ms window

        if (current_group && current_group.stream_id === event.stream_id && token_time - current_group.end_time <= time_window) {
          current_group.tokens.push({ seq: event.seq, text: event.text, timestamp: event.timestamp });
          current_group.end_time = token_time;
          current_group.seqs.push(event.seq);
        } else {
          const group_id = `group-${event.stream_id}-${event.seq}`;
          current_group = {
            type: "token_group",
            stream_id: event.stream_id,
            tokens: [{ seq: event.seq, text: event.text, timestamp: event.timestamp }],
            start_time: token_time,
            end_time: token_time,
            is_expanded: !!expanded_groups[group_id],
            seqs: [event.seq],
          };
          items.push(current_group);
        }
      } else {
        current_group = null; // Break grouping
        items.push({
          type: "single",
          event,
          seqs: [event.seq],
        });
      }
    }

    return items;
  }, [event_log, expanded_groups]);

  // Filter items
  const filtered_items = useMemo(() => {
    return grouped_items.filter((item) => {
      // Filter by type
      if (filter_type !== "ALL") {
        if (item.type === "token_group" && filter_type !== "TOKEN") return false;
        if (item.type === "single" && item.event.type !== filter_type) {
          // Group special checks
          if (filter_type === "TOOL" && (item.event.type === "TOOL_CALL" || item.event.type === "TOOL_RESULT")) {
            // Keep
          } else {
            return false;
          }
        }
      }

      // Filter by text search
      if (search_query.trim() !== "") {
        const query = search_query.toLowerCase();
        if (item.type === "token_group") {
          const text = item.tokens.map((t) => t.text).join("").toLowerCase();
          return text.includes(query) || item.stream_id.toLowerCase().includes(query);
        } else {
          const event = item.event;
          switch (event.type) {
            case "TOOL_CALL":
              return event.tool_name.toLowerCase().includes(query) || JSON.stringify(event.args).toLowerCase().includes(query);
            case "TOOL_RESULT":
              return event.call_id.toLowerCase().includes(query) || JSON.stringify(event.result).toLowerCase().includes(query);
            case "CONTEXT_SNAPSHOT":
              return event.context_id.toLowerCase().includes(query);
            case "ERROR":
              return event.message.toLowerCase().includes(query) || event.code.toLowerCase().includes(query);
            case "PING":
              return event.challenge.toLowerCase().includes(query);
            default:
              return false;
          }
        }
      }

      return true;
    });
  }, [grouped_items, filter_type, search_query]);

  // Virtualization constants
  const item_height = 36; // Height in pixels for collapsed rows
  const visible_count = Math.ceil(container_height / item_height) + 2;
  const start_idx = Math.max(0, Math.floor(scroll_top / item_height) - 1);
  const end_idx = Math.min(filtered_items.length, start_idx + visible_count);

  const virtual_items = filtered_items.slice(start_idx, end_idx);
  const total_height = filtered_items.length * item_height;
  const offset_y = start_idx * item_height;

  // Toggle group expansion
  const toggle_group = (group_key: string) => {
    set_expanded_groups((prev) => ({
      ...prev,
      [group_key]: !prev[group_key],
    }));
  };

  // Bidirectional scroll link handler
  const handle_row_click = (item: TimelineItem) => {
    if (item.type === "token_group") {
      on_event_click(`block-stream-${item.stream_id}`);
    } else {
      const event = item.event;
      if (event.type === "TOOL_CALL" || event.type === "TOOL_RESULT") {
        on_event_click(`block-tool-${event.call_id}`);
      }
    }
  };

  // Find matching tool matches for visual bridges
  const get_tool_partner_index = (call_id: string, current_idx: number) => {
    return filtered_items.findIndex(
      (item, idx) =>
        idx !== current_idx &&
        item.type === "single" &&
        (item.event.type === "TOOL_CALL" || item.event.type === "TOOL_RESULT") &&
        item.event.call_id === call_id
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.filter_bar}>
        <input
          type="text"
          value={search_query}
          onChange={(e) => set_search_query(e.target.value)}
          placeholder="Filter trace timeline..."
          className={styles.search_input}
        />
        <div className={styles.filter_buttons}>
          {["ALL", "TOKEN", "TOOL", "CONTEXT_SNAPSHOT", "PING", "ERROR"].map((type) => (
            <button
              key={type}
              className={`${styles.filter_btn} ${filter_type === type ? styles.filter_active : ""}`}
              onClick={() => set_filter_type(type)}
            >
              {type === "CONTEXT_SNAPSHOT" ? "CONTEXT" : type}
            </button>
          ))}
        </div>
      </div>

      <div
        className={styles.scroll_container}
        ref={container_ref}
        onScroll={handle_scroll}
      >
        <div className={styles.scroll_shim} style={{ height: total_height }}>
          <div className={styles.virtual_list} style={{ transform: `translateY(${offset_y}px)` }}>
            {virtual_items.map((item, local_idx) => {
              const global_idx = start_idx + local_idx;
              
              // Check if highlighted from ChatPanel selection
              const is_highlighted = active_highlight_seqs
                ? item.seqs.some((seq) => active_highlight_seqs.includes(seq))
                : false;

              if (item.type === "token_group") {
                const group_id = `group-${item.stream_id}-${item.tokens[0].seq}`;
                const duration = ((item.end_time - item.start_time) / 1000).toFixed(1);
                
                return (
                  <div
                    key={global_idx}
                    className={`${styles.row} ${is_highlighted ? styles.row_highlighted : ""}`}
                    onClick={() => handle_row_click(item)}
                    style={{ height: item_height }}
                  >
                    <span className={styles.seq_label}>#{item.tokens[0].seq}</span>
                    <span className={styles.type_badge_token}>STREAM</span>
                    <div className={styles.details} onClick={(e) => { e.stopPropagation(); toggle_group(group_id); }}>
                      <span className={styles.summary_text}>
                        Streamed {item.tokens.length} tokens ({duration}s)
                      </span>
                      <span className={styles.expand_arrow}>
                        {expanded_groups[group_id] ? "▲" : "▼"}
                      </span>
                    </div>
                    {expanded_groups[group_id] && (
                      <div className={styles.expanded_tokens}>
                        {item.tokens.map((t) => t.text).join("")}
                      </div>
                    )}
                  </div>
                );
              } else {
                const event = item.event;
                
                // Visual tool call lines linking logic
                let connector_style = {};
                const is_tool = event.type === "TOOL_CALL" || event.type === "TOOL_RESULT";
                if (is_tool) {
                  const partner_idx = get_tool_partner_index((event as SafeAny).call_id, global_idx);
                  if (partner_idx !== -1) {
                    connector_style = {
                      borderLeft: `2px dashed ${event.type === "TOOL_CALL" ? "#3b82f6" : "#10b981"}`,
                    };
                  }
                }

                return (
                  <div
                    key={global_idx}
                    className={`${styles.row} ${is_highlighted ? styles.row_highlighted : ""} ${
                      is_tool ? styles.tool_row : ""
                    }`}
                    onClick={() => handle_row_click(item)}
                    style={{ height: item_height, ...connector_style }}
                  >
                    <span className={styles.seq_label}>#{event.seq}</span>
                    
                    {event.type === "TOOL_CALL" && (
                      <>
                        <span className={styles.type_badge_call}>TOOL_CALL</span>
                        <span className={styles.details_mono}>{event.tool_name}</span>
                      </>
                    )}
                    {event.type === "TOOL_RESULT" && (
                      <>
                        <span className={styles.type_badge_res}>TOOL_RES</span>
                        <span className={styles.details_mono}>{event.call_id}</span>
                      </>
                    )}
                    {event.type === "CONTEXT_SNAPSHOT" && (
                      <>
                        <span className={styles.type_badge_ctx}>CONTEXT</span>
                        <span className={styles.details_mono}>{event.context_id}</span>
                      </>
                    )}
                    {event.type === "PING" && (
                      <>
                        <span className={styles.type_badge_ping}>PING</span>
                        <span className={styles.details_mono}>{event.challenge || "corrupt"}</span>
                      </>
                    )}
                    {event.type === "ERROR" && (
                      <>
                        <span className={styles.type_badge_err}>ERROR</span>
                        <span className={styles.details_err}>{event.code}</span>
                      </>
                    )}
                    {event.type === "STREAM_END" && (
                      <>
                        <span className={styles.type_badge_end}>END</span>
                        <span className={styles.details_mono}>{event.stream_id}</span>
                      </>
                    )}
                  </div>
                );
              }
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
