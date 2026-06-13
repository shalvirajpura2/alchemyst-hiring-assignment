import { useEffect, useState, useRef } from "react";
import { ProtocolEngine } from "../core/protocol_engine";
import { ProtocolEngineState } from "../core/event_types";

export function useBatchedEngineState(protocol_engine: ProtocolEngine): ProtocolEngineState {
  const [state, set_state] = useState<ProtocolEngineState>(() => ({
    ...protocol_engine.get_state(),
    // Clone properties to ensure new references
    buffer_map: new Map(protocol_engine.get_state().buffer_map),
    processed_seq_set: new Set(protocol_engine.get_state().processed_seq_set),
    event_log: [...protocol_engine.get_state().event_log],
    stream_state_map: new Map(protocol_engine.get_state().stream_state_map),
  }));

  const frame_id_ref = useRef<number | null>(null);
  const pending_update_ref = useRef<boolean>(false);

  useEffect(() => {
    const handle_change = () => {
      if (pending_update_ref.current) {
        return;
      }
      
      pending_update_ref.current = true;
      
      frame_id_ref.current = requestAnimationFrame(() => {
        pending_update_ref.current = false;
        
        const current_state = protocol_engine.get_state();
        
        // Deep copy the state members to trigger React re-renders properly
        set_state({
          expected_seq: current_state.expected_seq,
          last_committed_seq: current_state.last_committed_seq,
          last_rendered_seq: current_state.last_rendered_seq,
          buffer_map: new Map(current_state.buffer_map),
          processed_seq_set: new Set(current_state.processed_seq_set),
          event_log: [...current_state.event_log],
          stream_state_map: new Map(current_state.stream_state_map),
          duplicate_drops: current_state.duplicate_drops,
        });
      });
    };

    const unsubscribe = protocol_engine.subscribe(handle_change);
    
    return () => {
      unsubscribe();
      if (frame_id_ref.current !== null) {
        cancelAnimationFrame(frame_id_ref.current);
      }
    };
  }, [protocol_engine]);

  return state;
}
