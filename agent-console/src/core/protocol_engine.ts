import { AgentEvent, ProtocolEngineState, AgentEventInput } from "./event_types";

export class ProtocolEngine {
  private state: ProtocolEngineState;
  private change_listeners: Set<() => void> = new Set();
  private commit_listeners: Set<(event: AgentEvent) => void> = new Set();

  constructor() {
    this.state = {
      expected_seq: 1,
      last_committed_seq: 0,
      last_rendered_seq: 0,
      buffer_map: new Map(),
      processed_seq_set: new Set(),
      event_log: [],
      stream_state_map: new Map(),
      duplicate_drops: 0,
    };
  }

  get_state(): ProtocolEngineState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.change_listeners.add(listener);
    return () => this.change_listeners.delete(listener);
  }

  on_commit(listener: (event: AgentEvent) => void): () => void {
    this.commit_listeners.add(listener);
    return () => this.commit_listeners.delete(listener);
  }

  private notify() {
    this.change_listeners.forEach((listener) => listener());
  }

  ingest(event: AgentEventInput): void {
    const seq = event.seq;
    const timestamp = event.timestamp ?? Date.now();
    const full_event: AgentEvent = { ...event, timestamp } as AgentEvent;

    if (this.state.processed_seq_set.has(seq)) {
      this.state.duplicate_drops += 1;
      this.notify();
      return;
    }

    if (seq > this.state.expected_seq) {
      this.state.buffer_map.set(seq, full_event);
      this.notify();
      return;
    }

    if (seq < this.state.expected_seq) {
      this.state.duplicate_drops += 1;
      this.notify();
      return;
    }

    this.commit(full_event);

    while (this.state.buffer_map.has(this.state.expected_seq)) {
      const next_event = this.state.buffer_map.get(this.state.expected_seq)!;
      this.state.buffer_map.delete(this.state.expected_seq);
      this.commit(next_event);
    }

    this.notify();
  }

  private commit(event: AgentEvent): void {
    this.state.event_log.push(event);
    this.state.processed_seq_set.add(event.seq);
    this.state.last_committed_seq = event.seq;
    this.state.expected_seq = event.seq + 1;

    // Fire commit listeners
    this.commit_listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in commit listener:", err);
      }
    });

    const stream_id = "stream_id" in event ? event.stream_id : undefined;
    if (stream_id) {
      const current_state = this.state.stream_state_map.get(stream_id) ?? "idle";
      let next_state = current_state;

      switch (event.type) {
        case "TOKEN":
          if (current_state === "idle" || current_state === "ended" || current_state === "waiting_tool_result") {
            next_state = "streaming";
          }
          break;
        case "TOOL_CALL":
          next_state = "tool_call_active";
          break;
        case "TOOL_RESULT":
          next_state = "streaming";
          break;
        case "STREAM_END":
          next_state = "ended";
          break;
        case "ERROR":
          next_state = "ended";
          break;
      }

      if (next_state !== current_state) {
        this.state.stream_state_map.set(stream_id, next_state);
      }
    }
  }

  ack_tool_call(stream_id: string): void {
    const current_state = this.state.stream_state_map.get(stream_id);
    if (current_state === "tool_call_active") {
      this.state.stream_state_map.set(stream_id, "waiting_tool_result");
      this.notify();
    }
  }

  set_rendered_seq(seq: number): void {
    if (seq > this.state.last_rendered_seq) {
      this.state.last_rendered_seq = seq;
      this.notify();
    }
  }

  reset_session(): void {
    this.state = {
      expected_seq: 1,
      last_committed_seq: 0,
      last_rendered_seq: 0,
      buffer_map: new Map(),
      processed_seq_set: new Set(),
      event_log: [],
      stream_state_map: new Map(),
      duplicate_drops: 0,
    };
    this.notify();
  }
}
