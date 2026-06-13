import React, { useState, useRef, useEffect } from "react";
import { AgentEvent } from "../core/event_types";
import { SafeAny } from "../core/escape_hatch";
import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  event_log: AgentEvent[];
  connection_state: string;
  on_send: (content: string) => void;
  active_highlight_id: string | null;
  on_block_click: (event_seqs: number[]) => void;
}

export type ChatBlock =
  | { type: "text"; content: string; stream_id: string; event_seqs: number[] }
  | { type: "tool"; call_id: string; tool_name: string; args: SafeAny; state: "pending" | "done"; result?: SafeAny; event_seqs: number[] }
  | { type: "error"; message: string; code: string; event_seqs: number[] };

export default function ChatPanel({
  event_log,
  connection_state,
  on_send,
  active_highlight_id,
  on_block_click,
}: ChatPanelProps) {
  const [input_text, set_input_text] = useState("");
  const chat_end_ref = useRef<HTMLDivElement>(null);
  const container_ref = useRef<HTMLDivElement>(null);

  // Project events to chat blocks
  const project_blocks = (events: AgentEvent[]): ChatBlock[] => {
    const blocks: ChatBlock[] = [];
    let active_text_block: { type: "text"; content: string; stream_id: string; event_seqs: number[] } | null = null;

    for (const event of events) {
      if (event.type === "TOKEN") {
        if (active_text_block && active_text_block.stream_id === event.stream_id) {
          active_text_block.content += event.text;
          active_text_block.event_seqs.push(event.seq);
        } else {
          active_text_block = {
            type: "text",
            content: event.text,
            stream_id: event.stream_id,
            event_seqs: [event.seq],
          };
          blocks.push(active_text_block);
        }
      } else if (event.type === "TOOL_CALL") {
        active_text_block = null; // Freeze active text block
        blocks.push({
          type: "tool",
          call_id: event.call_id,
          tool_name: event.tool_name,
          args: event.args,
          state: "pending",
          event_seqs: [event.seq],
        });
      } else if (event.type === "TOOL_RESULT") {
        active_text_block = null; // Resume into a new text block
        const tool_block = blocks.find((b) => b.type === "tool" && b.call_id === event.call_id) as SafeAny;
        if (tool_block) {
          tool_block.state = "done";
          tool_block.result = event.result;
          tool_block.event_seqs.push(event.seq);
        }
      } else if (event.type === "STREAM_END") {
        active_text_block = null;
      } else if (event.type === "ERROR") {
        active_text_block = null;
        blocks.push({
          type: "error",
          message: event.message,
          code: event.code,
          event_seqs: [event.seq],
        });
      }
    }

    return blocks;
  };

  const chat_blocks = project_blocks(event_log);

  // Auto-scroll when messages stream
  useEffect(() => {
    chat_end_ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat_blocks.length, event_log.length]);

  // Handle highlighting from timeline
  useEffect(() => {
    if (active_highlight_id && container_ref.current) {
      const element = container_ref.current.querySelector(`#${active_highlight_id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add(styles.highlight_flash);
        const timer = setTimeout(() => {
          element.classList.remove(styles.highlight_flash);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [active_highlight_id]);

  const handle_submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input_text.trim() || connection_state === "disconnected") return;
    on_send(input_text);
    set_input_text("");
  };

  const trigger_keywords = [
    { label: "Hello", cmd: "hello" },
    { label: "Q3 Summary", cmd: "q3 summary report" },
    { label: "Comparison", cmd: "analyze and compare" },
    { label: "DB Schema", cmd: "schema database lookup" },
    { label: "Detailed Doc", cmd: "long detailed document" },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.blocks_feed} ref={container_ref}>
        {chat_blocks.length === 0 ? (
          <div className={styles.empty_state}>
            <div className={styles.empty_icon}>✦</div>
            <h3 className={styles.empty_title}>AI Agent Console</h3>
            <p className={styles.empty_subtitle}>
              Send a command to prompt the context-aware streaming agent. Choose a trigger keyword below to test specific execution pipelines.
            </p>
            <div className={styles.chips_container}>
              {trigger_keywords.map((kw) => (
                <button
                  key={kw.cmd}
                  className={styles.chip}
                  disabled={connection_state === "disconnected"}
                  onClick={() => on_send(kw.cmd)}
                >
                  {kw.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat_blocks.map((block, idx) => {
            if (block.type === "text") {
              const block_id = `block-stream-${block.stream_id}`;
              const is_highlighted = active_highlight_id === block_id;
              return (
                <div
                  key={idx}
                  id={block_id}
                  className={`${styles.text_block} ${is_highlighted ? styles.highlighted : ""}`}
                  onClick={() => on_block_click(block.event_seqs)}
                >
                  {block.content}
                </div>
              );
            } else if (block.type === "tool") {
              const block_id = `block-tool-${block.call_id}`;
              const is_highlighted = active_highlight_id === block_id;
              return (
                <div
                  key={idx}
                  id={block_id}
                  className={`${styles.tool_block} ${is_highlighted ? styles.highlighted : ""}`}
                  onClick={() => on_block_click(block.event_seqs)}
                >
                  <div className={styles.tool_header}>
                    <span className={styles.tool_badge}>TOOL CALL</span>
                    <span className={styles.tool_name}>{block.tool_name}</span>
                    <span
                      className={`${styles.tool_status} ${block.state === "pending" ? styles.status_pending : styles.status_done
                        }`}
                    >
                      {block.state === "pending" ? "Executing..." : "Completed"}
                    </span>
                  </div>

                  <div className={styles.tool_body}>
                    <div className={styles.json_label}>Arguments:</div>
                    <pre className={styles.json_code}>{JSON.stringify(block.args, null, 2)}</pre>

                    {block.state === "done" && (
                      <div className={styles.result_section}>
                        <div className={styles.json_label}>Result:</div>
                        <pre className={styles.json_code}>{JSON.stringify(block.result, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            } else {
              // Error block
              return (
                <div key={idx} className={styles.error_block}>
                  <div className={styles.error_header}>
                    <span>CRITICAL SERVER ERROR</span>
                    <span>{block.code}</span>
                  </div>
                  <div className={styles.error_message}>{block.message}</div>
                </div>
              );
            }
          })
        )}
        <div ref={chat_end_ref} />
      </div>

      <form onSubmit={handle_submit} className={styles.input_area}>
        <input
          type="text"
          value={input_text}
          onChange={(e) => set_input_text(e.target.value)}
          disabled={connection_state === "disconnected"}
          placeholder={
            connection_state === "disconnected"
              ? "Reconnecting to event stream..."
              : "Enter trigger keyword (e.g. hello, summary, analyze)..."
          }
          className={styles.input_box}
        />
        <button
          type="submit"
          disabled={!input_text.trim() || connection_state === "disconnected"}
          className={styles.send_button}
        >
          Send
        </button>
      </form>
    </div>
  );
}
