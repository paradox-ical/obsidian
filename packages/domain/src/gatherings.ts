export type RsvpResponse = "yes" | "maybe" | "no";
export type Seat = "going" | "waitlisted" | "none";

export const CHECK_IN_LEAD_MS = 15 * 60 * 1000;

/** A yes takes a seat when one is free, otherwise the waitlist. Maybe and no do not take a seat. */
export function seatFor(input: { response: RsvpResponse; going: number; capacity: number; waitlist: boolean }): Seat | "full" {
  if (input.response !== "yes") {
    return "none";
  }
  if (input.going < input.capacity) {
    return "going";
  }
  return input.waitlist ? "waitlisted" : "full";
}

export function checkInOpen(now: Date, startsAt: Date, endsAt: Date): boolean {
  return now.getTime() >= startsAt.getTime() - CHECK_IN_LEAD_MS && now.getTime() <= endsAt.getTime();
}

export function sessionSeat(input: { active: number; size: number; joinMode: "open" | "approval" }): "active" | "pending" | "waitlisted" | "full" {
  if (input.joinMode === "approval") {
    return "pending";
  }
  if (input.active < input.size) {
    return "active";
  }
  return input.size > 0 ? "waitlisted" : "full";
}
