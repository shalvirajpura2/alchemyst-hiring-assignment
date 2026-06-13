import { describe, it, expect } from "vitest";
import { ProtocolEngine } from "../core/protocol_engine";
import { AgentEventInput } from "../core/event_types";

describe("ProtocolEngine - Reordering & Deduplication Buffer", () => {
  it("should handle sequence events arriving in reversed order", () => {
    const engine = new ProtocolEngine();

    const event_3: AgentEventInput = {
      type: "TOKEN",
      seq: 3,
      stream_id: "s_01",
      text: "three",
    };
    const event_2: AgentEventInput = {
      type: "TOKEN",
      seq: 2,
      stream_id: "s_01",
      text: "two",
    };
    const event_1: AgentEventInput = {
      type: "TOKEN",
      seq: 1,
      stream_id: "s_01",
      text: "one",
    };

    engine.ingest(event_3);
    engine.ingest(event_2);
    expect(engine.get_state().event_log.length).toBe(0);
    expect(engine.get_state().buffer_map.size).toBe(2);

    engine.ingest(event_1);

    const log = engine.get_state().event_log;
    expect(log.length).toBe(3);
    expect(log[0].seq).toBe(1);
    expect(log[1].seq).toBe(2);
    expect(log[2].seq).toBe(3);
    expect(engine.get_state().buffer_map.size).toBe(0);
  });

  it("should filter out duplicate sequence events", () => {
    const engine = new ProtocolEngine();

    const event_1: AgentEventInput = {
      type: "TOKEN",
      seq: 1,
      stream_id: "s_01",
      text: "hello",
    };

    engine.ingest(event_1);
    engine.ingest(event_1); // duplicate

    expect(engine.get_state().event_log.length).toBe(1);
    expect(engine.get_state().duplicate_drops).toBe(1);
  });

  it("should queue elements and fill gaps when intermediate items arrive", () => {
    const engine = new ProtocolEngine();

    const event_1: AgentEventInput = {
      type: "TOKEN",
      seq: 1,
      stream_id: "s_01",
      text: "one",
    };
    const event_3: AgentEventInput = {
      type: "TOKEN",
      seq: 3,
      stream_id: "s_01",
      text: "three",
    };
    const event_2: AgentEventInput = {
      type: "TOKEN",
      seq: 2,
      stream_id: "s_01",
      text: "two",
    };

    engine.ingest(event_1);
    engine.ingest(event_3); // gap at 2

    expect(engine.get_state().event_log.length).toBe(1);
    expect(engine.get_state().buffer_map.has(3)).toBe(true);

    engine.ingest(event_2); // fills the gap

    expect(engine.get_state().event_log.length).toBe(3);
    expect(engine.get_state().buffer_map.size).toBe(0);
  });

  it("should drop overlapping replayed sequence elements safely", () => {
    const engine = new ProtocolEngine();

    const events: AgentEventInput[] = [
      { type: "TOKEN", seq: 1, stream_id: "s_01", text: "a" },
      { type: "TOKEN", seq: 2, stream_id: "s_01", text: "b" },
      { type: "TOKEN", seq: 3, stream_id: "s_01", text: "c" },
    ];

    events.forEach((ev) => engine.ingest(ev));
    expect(engine.get_state().event_log.length).toBe(3);

    // Replay event 2 and 3 (overlap)
    engine.ingest(events[1]); // seq 2
    engine.ingest(events[2]); // seq 3

    expect(engine.get_state().event_log.length).toBe(3);
    expect(engine.get_state().duplicate_drops).toBe(2);
  });
});
