export type AgentEvent =
  | { type: "TOKEN"; seq: number; stream_id: string; text: string; timestamp: number }
  | { type: "TOOL_CALL"; seq: number; stream_id: string; call_id: string; tool_name: string; args: Record<string, unknown>; timestamp: number }
  | { type: "TOOL_RESULT"; seq: number; stream_id: string; call_id: string; result: Record<string, unknown>; timestamp: number }
  | { type: "CONTEXT_SNAPSHOT"; seq: number; stream_id?: string; context_id: string; data: Record<string, unknown>; timestamp: number }
  | { type: "PING"; seq: number; stream_id?: string; challenge: string; timestamp: number }
  | { type: "STREAM_END"; seq: number; stream_id: string; timestamp: number }
  | { type: "ERROR"; seq: number; stream_id?: string; code: string; message: string; timestamp: number };

export type StreamState =
  | "idle"
  | "streaming"
  | "tool_call_active"
  | "waiting_tool_result"
  | "resuming"
  | "ended";

export interface ProtocolEngineState {
  expected_seq: number;
  last_committed_seq: number;
  last_rendered_seq: number;
  buffer_map: Map<number, AgentEvent>;
  processed_seq_set: Set<number>;
  event_log: AgentEvent[];
  stream_state_map: Map<string, StreamState>;
  duplicate_drops: number;
}

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type AgentEventInput = DistributiveOmit<AgentEvent, "timestamp"> & { timestamp?: number };

