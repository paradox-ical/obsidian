import type { ReactNode } from "react";

export function DiamondMark() {
  return (
    <svg className="diamond" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 8 24 16 16 24 8 16Z" fill="currentColor" />
    </svg>
  );
}

function focusContent(event: { preventDefault(): void }) {
  event.preventDefault();
  document.getElementById("dashboard-content")?.focus();
}

export function Shell(props: { title: string; children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#dashboard-content" onClick={focusContent}>Skip to content</a>
      <main className="shell" id="dashboard-content" tabIndex={-1}>
        <header className="masthead">
          <DiamondMark />
          <div>
            <p className="eyebrow">THE COLLECTIVE</p>
            <h1>{props.title}</h1>
          </div>
        </header>
        {props.children}
      </main>
    </>
  );
}
