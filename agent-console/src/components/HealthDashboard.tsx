import React from "react";
import { ConnectionState } from "../hooks/use_websocket";
import { ProtocolEngineState } from "../core/event_types";
import styles from "./HealthDashboard.module.css";

interface HealthDashboardProps {
  connection_state: ConnectionState;
  engine_state: ProtocolEngineState;
  ws_metrics: {
    reconnect_count: number;
    heartbeat_latency_ms: number;
    event_throughput: number;
    replay_count: number;
  };
  on_reset: () => void;
  on_reconnect: () => void;
  on_disconnect: () => void;
  on_trigger_auto_test?: () => void;
  is_auto_test_running?: boolean;
}

export default function HealthDashboard({
  connection_state,
  engine_state,
  ws_metrics,
  on_reset,
  on_reconnect,
  on_disconnect,
  on_trigger_auto_test,
  is_auto_test_running,
}: HealthDashboardProps) {
  const get_status_color = (state: ConnectionState) => {
    switch (state) {
      case "connected":
        return "#10b981"; // Green
      case "connecting":
      case "resuming":
        return "#3b82f6"; // Blue
      case "reconnecting":
        return "#f59e0b"; // Orange
      case "disconnected":
      default:
        return "#ef4444"; // Red
    }
  };

  const status_color = get_status_color(connection_state);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title_container}>
          <div
            className={styles.status_indicator}
            style={{ backgroundColor: status_color, boxShadow: `0 0 8px ${status_color}` }}
          />
          <h2 className={styles.title}>Observability Node</h2>
        </div>
        <div className={styles.actions}>
          {on_trigger_auto_test && (
            <button
              className={styles.btn_auto_test}
              onClick={on_trigger_auto_test}
              disabled={connection_state === "disconnected" || is_auto_test_running}
            >
              {is_auto_test_running ? "Running Auto Suite" : "Run Auto Suite"}
            </button>
          )}
          {connection_state === "disconnected" ? (
            <button className={styles.btn_connect} onClick={on_reconnect}>
              Connect
            </button>
          ) : (
            <button className={styles.btn_disconnect} onClick={on_disconnect}>
              Disconnect
            </button>
          )}
          <button className={styles.btn_reset} onClick={on_reset}>
            Reset Session
          </button>
        </div>
      </div>

      <div className={styles.metrics_grid}>
        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Transport State</span>
          <span className={styles.metric_value} style={{ color: status_color }}>
            {connection_state.toUpperCase()}
          </span>
        </div>

        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Expected Seq</span>
          <span className={styles.metric_value}>{engine_state.expected_seq}</span>
        </div>

        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Last Committed</span>
          <span className={styles.metric_value}>{engine_state.last_committed_seq}</span>
        </div>

        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Buffer Size</span>
          <span className={styles.metric_value} style={{ color: engine_state.buffer_map.size > 0 ? "#f59e0b" : "inherit" }}>
            {engine_state.buffer_map.size}
          </span>
        </div>

        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Duplicate Drops</span>
          <span className={styles.metric_value} style={{ color: engine_state.duplicate_drops > 0 ? "#ef4444" : "inherit" }}>
            {engine_state.duplicate_drops}
          </span>
        </div>

        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Heartbeat Latency</span>
          <span className={styles.metric_value}>
            {ws_metrics.heartbeat_latency_ms} <span className={styles.metric_unit}>ms</span>
          </span>
        </div>

        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Throughput</span>
          <span className={styles.metric_value}>{ws_metrics.event_throughput}</span>
        </div>

        <div className={styles.metric_card}>
          <span className={styles.metric_label}>Reconnects</span>
          <span className={styles.metric_value}>{ws_metrics.reconnect_count}</span>
        </div>
      </div>
    </div>
  );
}
