// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProtocolEngine } from "../core/protocol_engine";
import { useWebSocket } from "../hooks/use_websocket";
import { renderHook, act } from "@testing-library/react";

// Mock global WebSocket class
class MockWebSocket {
  url: string;
  readyState: number = 0; // CONNECTING
  send = vi.fn();
  close = vi.fn();

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    
    // Simulate connection opening on next tick
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 0);
  }
}

describe("WebSocket Transport & Reconnection State Recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("should trigger connection and send RESUME on reconnect", async () => {
    const engine = new ProtocolEngine();
    
    // Committing some event so last_committed_seq is non-zero
    engine.ingest({ type: "TOKEN", seq: 1, stream_id: "s_01", text: "hello" });
    expect(engine.get_state().last_committed_seq).toBe(1);

    const { result } = renderHook(() =>
      useWebSocket({
        ws_url: "ws://localhost:4747/ws",
        protocol_engine: engine,
      })
    );

    // Run timers to allow socket to open
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(result.current.connection_state).toBe("connected");
    const first_ws = MockWebSocket.instances[0];
    expect(first_ws).toBeDefined();

    // Trigger unexpected close
    await act(async () => {
      if (first_ws.onclose) {
        first_ws.onclose();
      }
    });

    // Should transition to reconnecting
    expect(result.current.connection_state).toBe("reconnecting");

    // Advance timer to trigger exponential backoff reconnect attempt (500ms)
    await act(async () => {
      vi.advanceTimersByTime(510);
    });

    const second_ws = MockWebSocket.instances[1];
    expect(second_ws).toBeDefined();
    
    // Simulate second connection opening
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    // When connection opens, it transitions to resuming and sends RESUME(1)
    expect(second_ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "RESUME", last_seq: 1 })
    );

    // Should transition back to connected after brief settling
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.connection_state).toBe("connected");
  });
});
