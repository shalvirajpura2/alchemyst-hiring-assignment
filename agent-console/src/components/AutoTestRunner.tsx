import React, { useState, useRef, useEffect } from "react";
import styles from "./AutoTestRunner.module.css";

export interface TestStep {
  label: string;
  status: "idle" | "running" | "success" | "failed";
}

interface AutoTestRunnerProps {
  is_running: boolean;
  active_step_index: number;
  steps: TestStep[];
  logs: string[];
  on_start: () => void;
  on_stop: () => void;
}

export default function AutoTestRunner({
  is_running,
  active_step_index,
  steps,
  logs,
  on_start,
  on_stop,
}: AutoTestRunnerProps) {
  const [is_minimized, set_is_minimized] = useState(false);
  const console_end_ref = useRef<HTMLDivElement>(null);

  // Auto-scroll console logs to bottom
  useEffect(() => {
    console_end_ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Expand card if test starts running
  useEffect(() => {
    if (is_running) {
      set_is_minimized(false);
    }
  }, [is_running]);

  const get_status_banner_text = () => {
    if (is_running) {
      return `Running step ${active_step_index + 1} of ${steps.length}`;
    }
    const all_success = steps.length > 0 && steps.every((s) => s.status === "success");
    if (all_success) {
      return "All scenarios completed successfully!";
    }
    return "Ready to run automated suite";
  };

  const get_status_banner_class = () => {
    if (is_running) return `${styles.status_banner} ${styles.status_banner_running}`;
    const all_success = steps.length > 0 && steps.every((s) => s.status === "success");
    if (all_success) return `${styles.status_banner} ${styles.status_banner_completed}`;
    return styles.status_banner;
  };

  if (is_minimized) {
    return (
      <div className={styles.widget_container}>
        <button className={styles.collapsed_bubble} onClick={() => set_is_minimized(false)}>
          <div className={`${styles.indicator_pulse} ${is_running ? styles.indicator_active : ""}`} />
          <span>Auto Test {is_running ? "Running" : "Suite"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={styles.widget_container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.title}>Automated Test Runner</div>
          <div className={styles.header_actions}>
            <button className={styles.btn_minimize} onClick={() => set_is_minimized(true)} title="Minimize">
              _
            </button>
          </div>
        </div>

        <div className={styles.body}>
          <div className={get_status_banner_class()}>
            {get_status_banner_text()}
          </div>

          <div className={styles.checklist}>
            {steps.map((step, idx) => {
              const is_active = is_running && idx === active_step_index;
              const text_class = is_active
                ? styles.item_text_active
                : step.status === "success"
                ? styles.item_text_completed
                : "";

              return (
                <div key={idx} className={styles.check_item}>
                  <div
                    className={`${styles.check_icon} ${
                      step.status === "running"
                        ? styles.icon_pending
                        : step.status === "success"
                        ? styles.icon_success
                        : styles.icon_idle
                    }`}
                  >
                    {step.status === "success" ? "Y" : step.status === "running" ? ">" : " "}
                  </div>
                  <span className={text_class}>{step.label}</span>
                </div>
              );
            })}
          </div>

          <div>
            <div className={styles.console_title}>Execution Logs</div>
            <div className={styles.console}>
              {logs.length === 0 ? (
                <div className={styles.log_line}>Console ready. Click Run to begin test suite...</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className={styles.log_line}>
                    {log}
                  </div>
                ))
              )}
              <div ref={console_end_ref} />
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          {is_running ? (
            <button className={styles.btn_stop} onClick={on_stop}>
              Stop Run
            </button>
          ) : (
            <button className={styles.btn_start} onClick={on_start}>
              Run Suite
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
