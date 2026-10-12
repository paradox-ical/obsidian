import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface OfferRow {
  slug: string;
  name: string;
  shop: string;
  currency: string;
  price: number;
  stock: number;
  limitPerMember: number;
  minLevel: number;
  version: number;
}

interface CrateRow {
  slug: string;
  name: string;
  version: number;
  policy: string;
  pityThreshold: number;
  guaranteeSlug: string;
  odds: Array<{ slug: string; weight: number; basisPoints: number }>;
}

interface StaffView {
  rules?: string;
  offers?: OfferRow[];
  crates?: CrateRow[];
  keys?: Record<string, number>;
  result?: string;
}

export function ShopPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<StaffView>({});
  const [notice, setNotice] = useState("");
  const [slug, setSlug] = useState("");
  const [price, setPrice] = useState("50");

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
          <p>The shop requires an admin session. Missing credentials do not buy stock, import a Steam key, open a crate, or refund a delivered key.</p>
          <p>Odds stay on the published table. A stored crate result is not rolled again from this page.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  async function reload() {
    const response = await fetch("/api/shop");
    setView(await response.json() as StaffView);
  }

  async function saveOffer(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/shop/offer", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ slug, name: slug, shop: "supply", currency: "marks", price: Number(price), stock: 1, limitPerMember: 1, minLevel: 1, requiredRoleId: "", classSlug: "", deliverable: "service", deliverableSlug: slug, amount: 1, duplicatePolicy: "keep" }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "Offer saved." : "The offer was not saved.");
    await reload();
  }

  return (
    <Shell title="Shop">
      <section className="panel">
        <h2>Offers</h2>
        <p>{view.rules}</p>
        <p>Available keys {view.keys?.available ?? 0}. Assigned keys {view.keys?.assigned ?? 0}. Revealed keys {view.keys?.revealed ?? 0}. Key material is not shown.</p>
        <ul>{view.offers?.map((offer) => <li key={offer.slug}>{offer.name}: {offer.price} {offer.currency}, stock {offer.stock}, limit {offer.limitPerMember}, level {offer.minLevel}, version {offer.version}.</li>)}</ul>
        <ul>{view.crates?.map((crate) => <li key={crate.slug}>{crate.name} version {crate.version}. {crate.policy}. Pity {crate.pityThreshold}. Guarantee {crate.guaranteeSlug}. {crate.odds.map((entry) => `${entry.slug} ${entry.basisPoints}`).join(", ")}.</li>)}</ul>
        {notice ? <p>{notice}</p> : null}
      </section>
      <form className="panel" onSubmit={(event) => void saveOffer(event)}>
        <h2>Offer</h2>
        <label>Slug <input value={slug} onChange={(event) => setSlug(event.target.value)} /></label>
        <label>Price <input value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        <button type="submit">Save offer</button>
      </form>
    </Shell>
  );
}
