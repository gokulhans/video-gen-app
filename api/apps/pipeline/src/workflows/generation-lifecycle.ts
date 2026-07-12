import type { GenerationJobState } from "@app/shared";

export type TransitionDecision = "apply" | "already_applied" | "reject";
export type ReservationStatus = "reserved" | "captured" | "released";
export type SettlementTarget = Exclude<ReservationStatus, "reserved">;

/** Pure decision helpers keep retries/replays deterministic and unit-testable. */
export function transitionDecision(
  current: GenerationJobState,
  from: GenerationJobState,
  to: GenerationJobState,
): TransitionDecision {
  if (current === to) return "already_applied";
  return current === from ? "apply" : "reject";
}

export function settlementDecision(
  current: ReservationStatus,
  target: SettlementTarget,
): TransitionDecision {
  if (current === target) return "already_applied";
  return current === "reserved" ? "apply" : "reject";
}
