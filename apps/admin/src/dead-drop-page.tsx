import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface CellView {
  coordinate: string;
  covered: boolean;
  asset: string;
  kind?: string;
}

interface StaffView {
  result?: string;
  rules?: string;
  clockLabel?: string;
  pickMarks?: number;
  seedMarks?: number;
  assetNotes?: string[];
  separateDesigns?: number;
  seedRemaining?: string;
  smallRemaining?: string;
  treasury?: string;
  board?: { boardId: string; status: string; jackpot: string; picksLeft: number; cells: CellView[]; specialKind: string } | null;
}

export function DeadDropPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<StaffView>({});
  const [notice, setNotice] = useState("");
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [amount, setAmount] = useState("");
  const [pool, setPool] = useState("seed");
  const [kind, setKind] = useState("collapse");
  const [payload, setPayload] = useState("");
  const [reason, setReason] = useState("");

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
          <p>Dead Drop requires an admin session. Missing credentials do not buy a pick, choose the opening hour, fund a prize, or activate a Market Collapse.</p>
          <p>The opening hour is not selected on this page. One card back and a set of reveal icons render every cell. Thirty-six board designs are not required.</p>
          <p>Positions stay hidden. A Market Collapse releases allocated event-treasury Ingots and does not mint, use the protected reserve, or reset the price.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  async function reload() {
    const response = await fetch("/api/dead-drop");
    setView(await response.json() as StaffView);
  }

  async function saveClock(event: FormEvent) {
    event.preventDefault();
    if (hour.trim() === "" || minute.trim() === "") {
      setNotice("Enter both an hour and a minute. No opening hour was assumed.");
      return;
    }
    const response = await fetch("/api/dead-drop/settings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ hour: Number(hour), minute: Number(minute) }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "Opening hour saved." : "The opening hour was not saved.");
    await reload();
  }

  async function fund(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/dead-drop/fund", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ pool, amountMarks: Number(amount), idempotencyKey: `dead-drop-fund:${pool}:${amount}:${Date.now()}`, reason: "Fund a Dead Drop budget" }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "funded" ? "Budget funded." : "The budget was not funded.");
    await reload();
  }

  async function saveSpecial(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/dead-drop/special", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ kind, payload, reason: reason || "Set a Dead Drop special board" }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "Special reward saved for the next board." : "The special reward was not saved.");
    await reload();
  }

  async function pause(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/dead-drop/pause", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ reason: reason || "Pause Dead Drop" }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "paused" ? "Board paused." : "The board was not paused.");
    await reload();
  }

  async function cancel(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/dead-drop/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ reason }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "cancelled" ? "Board cancelled and recorded picks refunded." : "The board was not cancelled.");
    await reload();
  }

  const covered = view.board?.cells.filter((cell) => cell.covered).length ?? 0;

  return (
    <Shell title="Dead Drop">
      <section className="panel">
        <h2>Shared board</h2>
        <p>{view.rules}</p>
        <p>{view.clockLabel ?? "The opening hour is not selected."}</p>
        <p>Pick {view.pickMarks ?? 100} Marks. Starting prize {view.seedMarks ?? 200} Marks. Seed remaining {view.seedRemaining ?? "0.00"}. Small rewards remaining {view.smallRemaining ?? "0.00"}. Treasury {view.treasury ?? "0.00"}.</p>
        <p>{(view.assetNotes ?? []).join(" ")} Separate designs: {view.separateDesigns ?? 0}.</p>
        {view.board ? <p>Board {view.board.boardId} is {view.board.status}. Jackpot {view.board.jackpot}. Covered cells {covered}. Special {view.board.specialKind || "none"}.</p> : <p>No board is open.</p>}
        {notice ? <p>{notice}</p> : null}
      </section>
      <form className="panel" onSubmit={(event) => void saveClock(event)}>
        <h2>Opening hour</h2>
        <p>Leave this blank until the owner chooses a Perth hour. This form does not fill one in.</p>
        <label>Hour <input value={hour} onChange={(event) => setHour(event.target.value)} /></label>
        <label>Minute <input value={minute} onChange={(event) => setMinute(event.target.value)} /></label>
        <button type="submit">Save opening hour</button>
      </form>
      <form className="panel" onSubmit={(event) => void fund(event)}>
        <h2>Budgets</h2>
        <label>Pool
          <select value={pool} onChange={(event) => setPool(event.target.value)}>
            <option value="seed">Starting prize</option>
            <option value="small">Small rewards</option>
          </select>
        </label>
        <label>Marks <input value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <button type="submit">Fund budget</button>
      </form>
      <form className="panel" onSubmit={(event) => void saveSpecial(event)}>
        <h2>Next special reward</h2>
        <label>Kind
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="collapse">Market Collapse</option>
            <option value="gear">Gear</option>
            <option value="crate">Crate</option>
            <option value="clue">Clue</option>
            <option value="clear">Clear</option>
          </select>
        </label>
        <label>Payload <input value={payload} onChange={(event) => setPayload(event.target.value)} /></label>
        <label>Reason <input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="submit">Save special reward</button>
      </form>
      <form className="panel" onSubmit={(event) => void pause(event)}>
        <h2>Pause</h2>
        <button type="submit">Pause the board</button>
      </form>
      <form className="panel" onSubmit={(event) => void cancel(event)}>
        <h2>Cancel</h2>
        <p>Cancellation refunds recorded picks and returns an unpaid seed. It does not move the hidden jackpot.</p>
        <button type="submit">Cancel and refund</button>
      </form>
    </Shell>
  );
}
