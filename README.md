# Event-Sourced AI Observability Console

A deterministic observability dashboard designed to monitor and interface with a streaming AI agent. The console handles unstable WebSocket channels by treating all network payloads as inputs to a deterministic protocol engine, projecting all visual states strictly from an immutable event log.

---

## Directory Structure

*   `agent-console/`: The Next.js 14 frontend console (TypeScript, Vanilla CSS).
*   `agent-server/`: The mock AI agent server simulating streaming and network failures.

---

## Quick Start

### 1. Start the Mock Agent Server

The server runs on port `4747`. You can run it via Docker or locally with Node.

#### Option A: Running with Docker (Recommended)
```bash
cd agent-server
docker build -t agent-server .
docker run -p 4747:4747 agent-server             # Normal mode
# OR
docker run -p 4747:4747 agent-server --mode chaos  # Chaos mode
```

#### Option B: Running Locally with Node (Node.js >= 20 required)
```bash
cd agent-server
npm install
npm run build
npm start                   # Normal mode
# OR
npm start -- --mode chaos   # Chaos mode
```

---

### 2. Start the Console Client

The frontend client runs on port `3000` (or `3001` if port 3000 is occupied).

```bash
cd agent-console
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or the port shown in terminal) in your browser.

---

### 3. Running the Test Suite

Run the Vitest unit tests inside the console directory to verify reordering, state recovery, and diffing engines:

```bash
cd agent-console
npm run test
```

---

## Technical Architecture & Trade-Offs

### 1. Sequence-Based Reordering & Deduplication
Network packets can arrive out-of-order or duplicate in unstable channels. The Protocol Engine manages this using a linear queue and tracking mechanism:
*   **Buffer Map (`Map<number, AgentEvent>`):** Arriving out-of-order packets (`seq > expected_seq`) are held in a hash map for O(1) insertions and lookups.
*   **Processed Set (`Set<number>`):** Tracks all successfully committed packet sequence numbers to filter out duplicate frames in O(1) time.
*   **Sequential Commit Loop:** When `seq === expected_seq` is received, it is committed to the event log. We then recursively check the buffer map for `expected_seq + 1`, committing buffered packets sequentially until a sequence gap is met.

### 2. Connection State Recovery (RESUME Handshake)
If the WebSocket drops mid-stream, the client performs the following recovery sequence:
*   **Event Log as Single Source of Truth:** Visual state is derived entirely by compiling the immutable event log. The socket transport does not update state directly.
*   **Handshake Protocol:** Upon establishing a new connection, the client sends a `RESUME` frame containing the `last_committed_seq`.
*   **Replay Ingestion:** The server replays all stream events after `last_committed_seq`. The client filters any re-sent frames using the duplicate processed set, resuming the live stream seamlessly.

### 3. Race Condition & Multi-Tab Isolation
To ensure robustness on production browsers:
*   **Stale Socket Rejection:** In React's strict mode or hot-reload cycles, multiple WebSockets may mount concurrently. All event callbacks match the source socket object against the active reference pointer (`socket === ws_ref.current`). Callbacks from stale sockets are rejected.
*   **Single-Client Lockout:** The mock server disconnects older sessions when a new client connects. The client detects the socket closure code `1000` and reason `replaced` inside `onclose`, immediately stopping automatic reconnection loops on background tabs.

### 4. Layout Reflow Prevention
Streaming text updates often trigger layout thrashing and DOM reflow. The chat interface mitigates this by projecting raw events into distinct block types:
*   **Block Isolation:** The parser organizes incoming data into `text`, `tool`, and `error` blocks.
*   **Freeze-on-Call:** When a tool call is initiated, the current text block reference is set to null, freezing its content. A new pending tool block is appended.
*   **Append-on-Resume:** When the tool finishes and token streaming resumes, the console starts a new text block below the tool block, leaving preceding blocks untouched and avoiding content layout shifts.