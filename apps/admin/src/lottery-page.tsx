import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface DrawRow {
  drawId: string;
  status: string;
  tickets: number;
  pot: string;
  bonus: string;
  deadline: string | null;
  stallAt: string;
  entries?: number;
}

interface StaffView {
  rules?: string;
  clockLabel?: string;
  ticketMarks?: number;
  cap?: number;
  stallDays?: number;
  budgetRemaining?: string;
  budgetReserved?: string;
  budgetSpent?: string;
  draw?: DrawRow | null;
  result?: string;
}

export function LotteryPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<StaffView>({});
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState("");
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then((response) => response.json() as Promise<AuthStatus>)
      .then((status) => {
        setAuth(status);
        if (status.authenticated) {
          void reload();
        }
      })
      .catch(() => setAuth({ authenticated: false }));
    return () => controller.abort();
  }, []);

  if (!auth?.authenticated || !auth.csrfToken) {
    return (
      <Shell title="Admin access is closed">
        <section className="panel">
          <p>The lottery requires an admin session. Missing credentials do not buy a ticket, choose a draw time, or fund the bonus.</p>
          <p>The draw time is not selected on this page. A stalled draw refunds ticket payments and returns the reserved bonus.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  async function reload() {
    const response = await fetch("/api/lottery");
    setView(await response.json() as StaffView);
  }

  async function saveClock(event: FormEvent) {
    event.preventDefault();
    if (hour.trim() === "" || minute.trim() === "") {
      setNotice("Enter both an hour and a minute. No draw time was assumed.");
      return;
    }
    const response = await fetch("/api/lottery/settings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ hour: Number(hour), minute: Number(minute) }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "Draw time saved." : "The draw time was not saved.");
    await reload();
  }

  async function fund(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/lottery/fund", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ amountMarks: Number(amount), idempotencyKey: `lottery-fund:${amount}:${Date.now()}`, reason: "Fund the lottery budget" }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "funded" ? "Budget funded." : "The budget was not funded.");
    await reload();
  }

  return (
    <Shell title="Lottery">
      <section className="panel">
        <h2>Daily draw</h2>
        <p>{view.rules}</p>
        <p>{view.clockLabel ?? "The draw time is not selected."}</p>
        <p>Ticket {view.ticketMarks ?? 100} Marks. Cap {view.cap ?? 5}. Stall {view.stallDays ?? 7} days. Remaining {view.budgetRemaining ?? "0.00"}. Reserved {view.budgetReserved ?? "0.00"}. Spent {view.budgetSpent ?? "0.00"}.</p>
        {view.draw ? <p>Open draw {view.draw.drawId}. Entries {view.draw.entries ?? 0}. Tickets {view.draw.tickets}. Pot {view.draw.pot}. Bonus {view.draw.bonus}. Deadline {view.draw.deadline ?? "not selected"}. Stall {view.draw.stallAt}.</p> : <p>No draw is open.</p>}
        {notice ? <p>{notice}</p> : null}
      </section>
      <form className="panel" onSubmit={(event) => void saveClock(event)}>
        <h2>Draw time</h2>
        <p>Leave this blank until the owner chooses a Perth hour. This form does not fill one in.</p>
        <label>Hour <input value={hour} onChange={(event) => setHour(event.target.value)} /></label>
        <label>Minute <input value={minute} onChange={(event) => setMinute(event.target.value)} /></label>
        <button type="submit">Save draw time</button>
      </form>
      <form className="panel" onSubmit={(event) => void fund(event)}>
        <h2>Budget</h2>
        <label>Marks <input value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <button type="submit">Fund budget</button>
      </form>
    </Shell>
  );
}
