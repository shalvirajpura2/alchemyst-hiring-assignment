import { useEffect, useRef, useState, useCallback } from "react";
import { ProtocolEngine } from "../core/protocol_engine";
import { AgentEvent } from "../core/event_types";
import { SafeAny } from "../core/escape_hatch";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "resuming";

interface UseWebSocketOptions {
  ws_url: string;
  protocol_engine: ProtocolEngine;
  on_state_change?: (state: ConnectionState) => void;
}

const backoff_delays = [500, 1000, 2000, 4000, 10000];

export function useWebSocket({ ws_url, protocol_engine, on_state_change }: UseWebSocketOptions) {
  const [connection_state, set_state] = useState<ConnectionState>("disconnected");
  const ws_ref = useRef<WebSocket | null>(null);
  const reconnect_timeout_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff_index_ref = useRef<number>(0);
  const is_manual_close_ref = useRef<boolean>(false);
  
  // Ref mirrors to resolve mutually recursive hook dependencies
  const connect_ref = useRef<() => void>(() => {});
  const trigger_reconnect_ref = useRef<() => void>(() => {});

  // Track metrics for the Health Dashboard
  const [metrics, set_metrics] = useState({
    reconnect_count: 0,
    heartbeat_latency_ms: 0,
    event_throughput: 0,
    replay_count: 0,
  });

  const update_state = useCallback((new_state: ConnectionState) => {
    set_state(new_state);
    if (on_state_change) {
      on_state_change(new_state);
    }
  }, [on_state_change]);

  const connect = useCallback(() => {
    if (ws_ref.current) {
      ws_ref.current.close();
    }

    is_manual_close_ref.current = false;
    update_state(backoff_index_ref.current > 0 ? "reconnecting" : "connecting");

    const socket = new WebSocket(ws_url);
    ws_ref.current = socket;

    socket.onopen = () => {
      if (socket !== ws_ref.current) return;
      const is_reconnect = backoff_index_ref.current > 0;
      backoff_index_ref.current = 0;

      if (is_reconnect) {
        update_state("resuming");
        const last_seq = protocol_engine.get_state().last_committed_seq;
        socket.send(JSON.stringify({ type: "RESUME", last_seq }));
        set_metrics((prev) => ({
          ...prev,
          replay_count: prev.replay_count + 1,
        }));
        // Transition back to connected after resume frame is dispatched
        setTimeout(() => {
          if (socket !== ws_ref.current) return;
          update_state("connected");
        }, 100);
      } else {
        update_state("connected");
      }
    };

    socket.onmessage = (event) => {
      if (socket !== ws_ref.current) return;
      let data: SafeAny;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!data || typeof data.type !== "string") {
        return;
      }

      // Record throughput
      set_metrics((prev) => ({
        ...prev,
        event_throughput: prev.event_throughput + 1,
      }));

      // Ingest the server message
      if (data.type === "PING") {
        const ping_seq = typeof data.seq === "number" ? data.seq : 0;
        const challenge = typeof data.challenge === "string" ? data.challenge : "";
        const ping_sent_at = Date.now();
        
        // Protocol engine ingests the ping for ordering
        protocol_engine.ingest({
          type: "PING",
          seq: ping_seq,
          challenge,
        } as AgentEvent);

        // Transport replies immediately to meet the 3-second heartbeat SLA
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "PONG", echo: challenge }));
          
          const latency = Date.now() - ping_sent_at;
          set_metrics((prev) => ({
            ...prev,
            heartbeat_latency_ms: latency,
          }));
        }
      } else {
        // Direct event ingestion into the protocol engine
        protocol_engine.ingest(data as AgentEvent);
      }
    };

    socket.onclose = (event?: CloseEvent) => {
      if (socket !== ws_ref.current) return;
      ws_ref.current = null;

      if (event?.reason === "replaced") {
        update_state("disconnected");
        console.warn("[WebSocket] Connection closed because it was replaced by a new tab/session.");
        return;
      }

      if (is_manual_close_ref.current) {
        update_state("disconnected");
      } else {
        trigger_reconnect_ref.current();
      }
    };

    socket.onerror = () => {
      if (socket !== ws_ref.current) return;
      // Socket handles errors by closing, which will trigger reconnect
      socket.close();
    };
  }, [ws_url, protocol_engine, update_state]);

  const trigger_reconnect = useCallback(() => {
    update_state("reconnecting");
    
    if (reconnect_timeout_ref.current) {
      clearTimeout(reconnect_timeout_ref.current);
    }

    const delay = backoff_delays[backoff_index_ref.current] ?? 10000;
    
    // Increment backoff index
    if (backoff_index_ref.current < backoff_delays.length - 1) {
      backoff_index_ref.current += 1;
    }

    set_metrics((prev) => ({
      ...prev,
      reconnect_count: prev.reconnect_count + 1,
    }));

    reconnect_timeout_ref.current = setTimeout(() => {
      connect_ref.current();
    }, delay);
  }, [update_state]);

  // Update ref mirrors
  connect_ref.current = connect;
  trigger_reconnect_ref.current = trigger_reconnect;

  const disconnect = useCallback(() => {
    is_manual_close_ref.current = true;
    if (reconnect_timeout_ref.current) {
      clearTimeout(reconnect_timeout_ref.current);
      reconnect_timeout_ref.current = null;
    }
    backoff_index_ref.current = 0;
    if (ws_ref.current) {
      ws_ref.current.close();
      ws_ref.current = null;
    }
    update_state("disconnected");
  }, [update_state]);

  const simulate_drop = useCallback(() => {
    is_manual_close_ref.current = false;
    backoff_index_ref.current = 1; // trigger short backoff on close
    if (ws_ref.current) {
      ws_ref.current.close();
    }
  }, []);

  const send_user_message = useCallback((content: string) => {
    if (ws_ref.current && ws_ref.current.readyState === WebSocket.OPEN) {
      // Start a new turn: clear previous engine sequence logs
      protocol_engine.reset_session();
      
      ws_ref.current.send(
        JSON.stringify({
          type: "USER_MESSAGE",
          content,
        })
      );
    }
  }, [protocol_engine]);

  useEffect(() => {
    const unsubscribe = protocol_engine.on_commit((event) => {
      if (event.type === "TOOL_CALL") {
        const socket = ws_ref.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "TOOL_ACK",
              call_id: event.call_id,
            })
          );
          protocol_engine.ack_tool_call(event.stream_id);
        }
      }
    });
    return () => unsubscribe();
  }, [protocol_engine]);

  useEffect(() => {
    connect_ref.current();
    return () => {
      is_manual_close_ref.current = true;
      if (reconnect_timeout_ref.current) {
        clearTimeout(reconnect_timeout_ref.current);
      }
      if (ws_ref.current) {
        ws_ref.current.close();
      }
    };
  }, []);

  return {
    connection_state,
    metrics,
    send_user_message,
    reconnect: connect,
    disconnect,
    simulate_drop,
  };
}
