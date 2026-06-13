/* eslint-disable @typescript-eslint/no-explicit-any */
// ─────────────────────────────────────────────────────────────
// Escape Hatch
//
// This is the single canonical escape hatch file allowed by the
// assignment guidelines. We declare SafeAny to support generic
// JSON payloads and untyped dynamic parameters.
// ─────────────────────────────────────────────────────────────

export type SafeAny = any;
