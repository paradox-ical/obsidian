import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface StaffView {
  result?: string;
  rules?: string[];
  rulesVersion?: number;
  hitSoft17?: boolean;
  minBetMarks?: number;
  maxBetMarks?: number;
  tableCap?: number;
  bankrollAvailable?: string;
  bankrollReserved?: string;
  economy?: { worstPlayerLossMarks?: number; smallRelativeToSlowEconomy?: boolean; exampleNaturalProfit?: string };
}

export function BlackjackPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<StaffView>({});
  const [notice, setNotice] = useState("");
  const [maxBet, setMaxBet] = useState("");
  const [amount, setAmount] = useState("");
  const [tableId, setTableId] = useState("");
  const [reason, setReason] = useState("");
  const [hitSoft17, setHitSoft17] = useState(false);

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
          <p>Blackjack requires an admin session. Missing credentials do not place a bet, change the table rules, or fund the house bankroll.</p>
          <p>The house reserves the worst split and double payout before it accepts a bet. A retry uses the stored shoe.</p>
          <p>The default maximum bet is 10 Marks. One split and two doubles can lose 40 Marks, which stays small beside the 7,987 Mark routine month. A one-Mark natural pays 1.50.</p>
          <p>Inactivity stands the hand. A system cancellation refunds an unsettled stake. There is no hidden forced-loss rule.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  async function reload() {
    const response = await fetch("/api/blackjack");
    const body = await response.json() as StaffView;
    setView(body);
    setHitSoft17(body.hitSoft17 === true);
  }

  async function saveRules(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/blackjack/settings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ ...(maxBet.trim() ? { maxBetMarks: Number(maxBet) } : {}), hitSoft17 }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "The table rules were saved for the next table." : "The table rules were not saved.");
    await reload();
  }

  async function fund(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/blackjack/fund", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ amountMarks: Number(amount), idempotencyKey: `blackjack-admin-${Date.now()}`, reason: reason || "Fund the house bankroll" }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "funded" ? "The house bankroll was funded." : "The house bankroll was not funded.");
    await reload();
  }

  async function cancel(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setNotice("A cancellation needs a reason. Nothing was refunded.");
      return;
    }
    const response = await fetch("/api/blackjack/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ tableId, reason }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "cancelled" ? "The unsettled stakes were refunded." : "The table was not cancelled.");
    await reload();
  }

  return (
    <Shell title="Blackjack">
      <section className="panel">
        <p>{view.rules?.join(" ")}</p>
        <p>Rules version {view.rulesVersion}. Bankroll available {view.bankrollAvailable}. Reserved {view.bankrollReserved}. Worst player loss {view.economy?.worstPlayerLossMarks} Marks. A one-Mark natural pays {view.economy?.exampleNaturalProfit}.</p>
        <form onSubmit={(event) => void saveRules(event)}>
          <label>Maximum bet<input value={maxBet} onChange={(event) => setMaxBet(event.target.value)} inputMode="numeric" /></label>
          <label><input type="checkbox" checked={hitSoft17} onChange={(event) => setHitSoft17(event.target.checked)} /> Dealer hits soft 17</label>
          <button type="submit">Save rules for the next table</button>
        </form>
        <form onSubmit={(event) => void fund(event)}>
          <label>Fund Marks<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" /></label>
          <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="submit">Fund the bankroll</button>
        </form>
        <form onSubmit={(event) => void cancel(event)}>
          <label>Table<input value={tableId} onChange={(event) => setTableId(event.target.value)} /></label>
          <button type="submit">Cancel and refund unsettled stakes</button>
        </form>
        {notice ? <p>{notice}</p> : null}
        <p><a href="/">Return to the dashboard</a></p>
      </section>
    </Shell>
  );
}
