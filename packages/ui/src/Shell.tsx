import type { ReactNode } from "react";

export function DiamondMark() {
  return (
    <svg className="diamond" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 8 24 16 16 24 8 16Z" fill="currentColor" />
    </svg>
  );
}

const NAV = [
  { label: "Overview", links: [{ href: "/", label: "Dashboard" }] },
  {
    label: "People",
    links: [
      { href: "/community", label: "Verification" },
      { href: "/moderation", label: "Moderation" },
      { href: "/tickets", label: "Tickets" },
      { href: "/progression", label: "Progression" },
    ],
  },
  {
    label: "Economy",
    links: [
      { href: "/economy", label: "Economy" },
      { href: "/market", label: "Market" },
      { href: "/shop", label: "Shop" },
      { href: "/lottery", label: "Lottery" },
      { href: "/dead-drop", label: "Dead Drop" },
      { href: "/blackjack", label: "Blackjack" },
    ],
  },
  {
    label: "World",
    links: [
      { href: "/characters", label: "Characters" },
      { href: "/combat", label: "Combat" },
      { href: "/world", label: "Regions" },
      { href: "/contracts", label: "Contracts" },
      { href: "/activities", label: "Activities" },
      { href: "/gatherings", label: "Events" },
      { href: "/seasons", label: "Seasons" },
    ],
  },
  {
    label: "Desk",
    links: [
      { href: "/publications", label: "Publications" },
      { href: "/operations", label: "Operations" },
    ],
  },
] as const;

function focusContent(event: { preventDefault(): void }) {
  event.preventDefault();
  document.getElementById("dashboard-content")?.focus();
}

function currentPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname;
}

export function Shell(props: { title: string; children: ReactNode }) {
  const path = currentPath();
  return (
    <div className="app-frame">
      <a className="skip-link" href="#dashboard-content" onClick={focusContent}>Skip to content</a>
      <aside className="sidebar">
        <a className="brand" href="/">
          <DiamondMark />
          <span>
            <strong>The Collective</strong>
            <small>Admin desk</small>
          </span>
        </a>
        <nav aria-label="Dashboard">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              <ul>
                {group.links.map((link) => {
                  const active = link.href === "/" ? path === "/" : path === link.href || path.startsWith(`${link.href}/`);
                  return (
                    <li key={link.href}>
                      <a href={link.href} aria-current={active ? "page" : undefined}>{link.label}</a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="workspace">
        <header className="masthead">
          <p className="eyebrow">The Collective</p>
          <h1>{props.title}</h1>
        </header>
        <main id="dashboard-content" tabIndex={-1}>
          {props.children}
        </main>
      </div>
    </div>
  );
}
