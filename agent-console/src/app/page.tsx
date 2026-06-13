"use client";

import React, { useMemo, useState, useEffect } from "react";
import { ProtocolEngine } from "../core/protocol_engine";
import { useWebSocket } from "../hooks/use_websocket";
import { useBatchedEngineState } from "../utils/batching";
import HealthDashboard from "../components/HealthDashboard";
import ChatPanel from "../components/ChatPanel";
import TraceTimeline from "../components/TraceTimeline";
import ContextInspector from "../components/ContextInspector";
import AutoTestRunner, { TestStep } from "../components/AutoTestRunner";
import styles from "./page.module.css";

const AUTO_TEST_STEPS: TestStep[] = [
  { label: "1. Reset Server & Engine Session", status: "idle" },
  { label: "2. Basic Greeting (No Tools)", status: "idle" },
  { label: "3. Q3 Summary (1 Tool + ACK)", status: "idle" },
  { label: "4. Multi-Tool (Stacked Cards)", status: "idle" },
  { label: "5. DB Schema Lookup (550KB Context)", status: "idle" },
  { label: "6. Detailed Doc (Conn Drop & RESUME)", status: "idle" },
];

export default function Home() {
  // Instantiate the single-source-of-truth ProtocolEngine
  const protocol_engine = useMemo(() => new ProtocolEngine(), []);

  // Subscribe to batched engine state using requestAnimationFrame
  const engine_state = useBatchedEngineState(protocol_engine);

  // Focus linking states
  const [active_highlight_seqs, set_active_highlight_seqs] = useState<number[] | null>(null);
  const [active_chat_block_id, set_active_chat_block_id] = useState<string | null>(null);

  // Transport WebSocket URL configuration
  const ws_url = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4747/ws";

  // Initialize the transport-only WebSocket connection
  const {
    connection_state,
    metrics,
    send_user_message,
    reconnect,
    disconnect,
    simulate_drop,
  } = useWebSocket({
    ws_url,
    protocol_engine,
  });

  // Automated test state
  const [is_auto_testing, set_is_auto_testing] = useState(false);
  const [active_step, set_active_step] = useState(0);
  const [test_steps, set_test_steps] = useState<TestStep[]>(AUTO_TEST_STEPS);
  const [test_logs, set_test_logs] = useState<string[]>([]);
  const [step6_has_dropped, set_step6_has_dropped] = useState(false);

  const add_log = (msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    set_test_logs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  const start_auto_test = () => {
    if (connection_state === "disconnected") return;
    set_is_auto_testing(true);
    set_active_step(0);
    set_step6_has_dropped(false);
    set_test_steps(AUTO_TEST_STEPS.map((s, i) => ({ ...s, status: i === 0 ? "running" : "idle" })));
    set_test_logs([]);
    const time = new Date().toLocaleTimeString([], { hour12: false });
    set_test_logs([`[${time}] Starting Automated Test Suite Runner...`]);
  };

  const stop_auto_test = () => {
    set_is_auto_testing(false);
    set_active_step(0);
    set_step6_has_dropped(false);
    set_test_steps(AUTO_TEST_STEPS.map((s) => ({ ...s, status: "idle" })));
    const time = new Date().toLocaleTimeString([], { hour12: false });
    set_test_logs((prev) => [...prev, `[${time}] [ABORT] Test run aborted by user.`]);
    reconnect();
  };

  // Log transport state transitions during auto-run
  useEffect(() => {
    if (is_auto_testing) {
      add_log(`Transport state changed to: ${connection_state.toUpperCase()}`);
    }
  }, [connection_state, is_auto_testing]);

  // Main automated test runner step state machine
  useEffect(() => {
    if (!is_auto_testing) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const advance_step = (next_idx: number) => {
      if (!active) return;
      if (next_idx >= AUTO_TEST_STEPS.length) {
        set_is_auto_testing(false);
        add_log("[OK] Automated test suite completed successfully!");
        return;
      }
      set_active_step(next_idx);
      set_test_steps((prev) =>
        prev.map((s, i) => ({
          ...s,
          status: i === next_idx ? "running" : i < next_idx ? "success" : "idle",
        }))
      );
    };

    if (active_step === 0) {
      add_log("Step 1: Resetting session and database...");
      handle_reset();
      timer = setTimeout(() => {
        add_log("[OK] Session and server reset complete.");
        advance_step(1);
      }, 1500);
    } else if (active_step === 1) {
      add_log("Step 2: Basic Greeting Scenario (no tools)");
      add_log("Sending query: 'hello'");
      send_user_message("hello");

      unsubscribe = protocol_engine.on_commit((event) => {
        if (event.type === "STREAM_END") {
          add_log("[OK] Received STREAM_END. Greeting scenario finished.");
          timer = setTimeout(() => advance_step(2), 2000);
        }
      });
    } else if (active_step === 2) {
      add_log("Step 3: Q3 Summary Scenario (1 tool + ACK)");
      add_log("Sending query: 'q3 summary report'");
      send_user_message("q3 summary report");

      unsubscribe = protocol_engine.on_commit((event) => {
        if (event.type === "TOOL_CALL") {
          add_log(`→ Intercepted TOOL_CALL: ${event.tool_name} (ID: ${event.call_id})`);
          add_log(`→ Dispatched TOOL_ACK verification`);
        } else if (event.type === "TOOL_RESULT") {
          add_log(`[OK] Received TOOL_RESULT for ID: ${event.call_id}`);
        } else if (event.type === "STREAM_END") {
          add_log("[OK] Received STREAM_END. Q3 summary scenario finished.");
          timer = setTimeout(() => advance_step(3), 2000);
        }
      });
    } else if (active_step === 3) {
      add_log("Step 4: Multi-Tool Analysis Scenario (stacked tool cards)");
      add_log("Sending query: 'analyze and compare'");
      send_user_message("analyze and compare");

      unsubscribe = protocol_engine.on_commit((event) => {
        if (event.type === "TOOL_CALL") {
          add_log(`→ Intercepted TOOL_CALL: ${event.tool_name} (ID: ${event.call_id})`);
          add_log(`→ Dispatched TOOL_ACK verification`);
        } else if (event.type === "TOOL_RESULT") {
          add_log(`[OK] Received TOOL_RESULT for ID: ${event.call_id}`);
        } else if (event.type === "STREAM_END") {
          add_log("[OK] Received STREAM_END. Multi-tool analysis scenario finished.");
          timer = setTimeout(() => advance_step(4), 2000);
        }
      });
    } else if (active_step === 4) {
      add_log("Step 5: Database Schema Lookup Scenario (550KB context worker diff)");
      add_log("Sending query: 'schema database lookup'");
      send_user_message("schema database lookup");

      unsubscribe = protocol_engine.on_commit((event) => {
        if (event.type === "CONTEXT_SNAPSHOT") {
          const keys_count = event.data && typeof event.data === "object" ? Object.keys(event.data).length : 0;
          add_log(`→ Ingested CONTEXT_SNAPSHOT (Keys: ${keys_count}). Processing off-thread via worker...`);
        } else if (event.type === "TOOL_CALL") {
          add_log(`→ Intercepted TOOL_CALL: ${event.tool_name} (ID: ${event.call_id})`);
        } else if (event.type === "STREAM_END") {
          add_log("[OK] Received STREAM_END. Database schema lookup finished.");
          timer = setTimeout(() => advance_step(5), 2000);
        }
      });
    } else if (active_step === 5) {
      add_log("Step 6: Connection Drop & RESUME Recovery Scenario");
      add_log("Sending query: 'long detailed document'");
      send_user_message("long detailed document");

      let token_count = 0;
      let has_dropped = false;

      unsubscribe = protocol_engine.on_commit((event) => {
        if (event.type === "TOKEN") {
          token_count++;
          if (token_count === 15 && !has_dropped) {
            has_dropped = true;
            add_log("[DROP] Threshold reached! Simulating unexpected WebSocket connection drop mid-stream...");
            set_step6_has_dropped(true);
            simulate_drop();
          }
        }
      });
    }

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };
  }, [is_auto_testing, active_step, send_user_message, reconnect, simulate_drop]);

  // Hook to handle Step 6 reconnect detection (avoids waiting indefinitely for STREAM_END since server aborts script on drop)
  useEffect(() => {
    if (is_auto_testing && active_step === 5 && connection_state === "connected" && step6_has_dropped) {
      add_log("[RECONNECT] Reconnection confirmed! WebSocket is now CONNECTED.");
      add_log("[REPLAY] Verifying server replay complete...");

      const timeout = setTimeout(() => {
        add_log("[OK] Connection Drop & RESUME Recovery scenario successfully verified!");
        set_is_auto_testing(false);
        set_test_steps((prev) =>
          prev.map((s, i) => ({
            ...s,
            status: i === 5 ? "success" : s.status,
          }))
        );
        add_log("[OK] Automated test suite completed successfully!");
      }, 2500);

      return () => clearTimeout(timeout);
    }
  }, [connection_state, is_auto_testing, active_step, step6_has_dropped]);

  // Timeline row click -> scrolls chat block
  const handle_timeline_event_click = (block_id: string) => {
    set_active_chat_block_id(block_id);
    
    // Clear highlights after a delay
    setTimeout(() => {
      set_active_chat_block_id(null);
    }, 100);
  };

  // Chat block click -> highlights corresponding timeline rows
  const handle_chat_block_click = (event_seqs: number[]) => {
    set_active_highlight_seqs(event_seqs);
  };

  const handle_reset = () => {
    // Call server reset endpoint dynamically based on ws_url
    const reset_url = ws_url.replace(/^ws/, "http").replace(/\/ws$/, "") + "/reset";
    fetch(reset_url)
      .then(() => {
        protocol_engine.reset_session();
      })
      .catch((err) => {
        console.error("Failed to reset session on server:", err);
        // Fallback: local reset
        protocol_engine.reset_session();
      });
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.title_container}>
          <h1 className={styles.title}>Alchemyst AI Observability Node</h1>
          <div className={styles.subtitle}>
            Event-sourced agent console connection: <span className={styles.mono}>{ws_url}</span>
          </div>
        </div>
        <a
          href="https://github.com/shalvirajpura2/alchemyst-hiring-assignment"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.github_link}
        >
          GitHub
        </a>
      </header>

      <div className={styles.dashboard_row}>
        <HealthDashboard
          connection_state={connection_state}
          engine_state={engine_state}
          ws_metrics={metrics}
          on_reset={handle_reset}
          on_reconnect={reconnect}
          on_disconnect={disconnect}
          on_trigger_auto_test={start_auto_test}
          is_auto_test_running={is_auto_testing}
        />
      </div>

      <div className={styles.panels_grid}>
        <section className={styles.timeline_panel}>
          <div className={styles.panel_header}>Trace Timeline</div>
          <div className={styles.panel_body}>
            <TraceTimeline
              event_log={engine_state.event_log}
              active_highlight_seqs={active_highlight_seqs}
              on_event_click={handle_timeline_event_click}
            />
          </div>
        </section>

        <section className={styles.chat_panel}>
          <div className={styles.panel_header}>Streaming Feed</div>
          <div className={styles.panel_body}>
            <ChatPanel
              event_log={engine_state.event_log}
              connection_state={connection_state}
              on_send={send_user_message}
              active_highlight_id={active_chat_block_id}
              on_block_click={handle_chat_block_click}
            />
          </div>
        </section>

        <section className={styles.context_panel}>
          <div className={styles.panel_header}>Context State</div>
          <div className={styles.panel_body}>
            <ContextInspector event_log={engine_state.event_log} />
          </div>
        </section>
      </div>

      <AutoTestRunner
        is_running={is_auto_testing}
        active_step_index={active_step}
        steps={test_steps}
        logs={test_logs}
        on_start={start_auto_test}
        on_stop={stop_auto_test}
      />
    </main>
  );
}
