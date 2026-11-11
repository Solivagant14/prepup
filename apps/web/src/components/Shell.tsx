/**
 * The frame around every signed-in screen: where you are, how to get to the
 * other screens, and who is signed in. A top bar on wide screens; on a phone
 * the sections move to a bar at the bottom, where a thumb reaches them.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HostLinkTargets } from "../lib/api.js";
import { signedInLabel, type AccountInfo } from "../lib/account.js";
import { PATHS, type Screen } from "../lib/route.js";
import { HostLinks } from "./HostLinks.js";
import { Link } from "./Link.js";

const SECTIONS: { screen: Screen; label: string; icon: ReactNode }[] = [
  { screen: "deck", label: "Deck", icon: <DeckIcon /> },
  { screen: "claude", label: "Claude", icon: <ChatIcon /> },
  { screen: "account", label: "Account", icon: <PersonIcon /> },
];

export function Shell({
  screen,
  account,
  links,
  onSignOut,
  children,
}: {
  screen: Screen;
  account: AccountInfo | null;
  links: HostLinkTargets;
  onSignOut?: () => void;
  children: ReactNode;
}) {
  const current = (s: Screen) => (s === screen ? ("page" as const) : undefined);
  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar-in">
          <Link to={PATHS.deck} className="brand">
            PrepUp
          </Link>
          <nav className="appnav" aria-label="Sections">
            {SECTIONS.filter((s) => s.screen !== "account").map((s) => (
              <Link key={s.screen} to={PATHS[s.screen]} aria-current={current(s.screen)}>
                {s.label}
              </Link>
            ))}
          </nav>
          <AccountMenu account={account} onAccount={screen === "account"} onSignOut={onSignOut} />
        </div>
      </header>

      <main>{children}</main>

      <footer className="app-foot">
        <HostLinks links={links} showCosts={screen !== "costs"} />
      </footer>

      <nav className="tabbar" aria-label="Sections">
        {SECTIONS.map((s) => (
          <Link key={s.screen} to={PATHS[s.screen]} aria-current={current(s.screen)}>
            {s.icon}
            {s.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The round button at the end of the top bar, and the small menu it opens. */
function AccountMenu({
  account,
  onAccount,
  onSignOut,
}: {
  account: AccountInfo | null;
  onAccount: boolean;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Clicking elsewhere or pressing Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      box.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const initial = account?.email?.trim().charAt(0).toUpperCase();
  const close = () => setOpen(false);
  return (
    <div className="account-menu" ref={box}>
      <button
        type="button"
        className="avatar"
        aria-label="Account menu"
        aria-haspopup="true"
        aria-expanded={open}
        aria-current={onAccount ? "page" : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {initial || <PersonIcon />}
      </button>
      {open && (
        <div className="menu">
          <div className="menu-who">
            <div className="menu-how">{signedInLabel(account)}</div>
            {account?.email && <div className="menu-email">{account.email}</div>}
          </div>
          <Link to={PATHS.account} className="menu-item" onClick={close}>
            <PersonIcon />
            Account
          </Link>
          <Link to={PATHS.costs} className="menu-item" onClick={close}>
            <CoinIcon />
            What PrepUp costs
          </Link>
          {onSignOut && (
            <button
              type="button"
              className="menu-item menu-end"
              onClick={() => {
                close();
                onSignOut();
              }}
            >
              <SignOutIcon />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const icon = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function DeckIcon() {
  return (
    <svg {...icon}>
      <rect x="3" y="7" width="13" height="13" rx="2.5" />
      <path d="M8 4h10.5A2.5 2.5 0 0 1 21 6.5V17" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg {...icon}>
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" />
    </svg>
  );
}
function PersonIcon() {
  return (
    <svg {...icon}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
function CoinIcon() {
  return (
    <svg {...icon}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.5c-.4-.9-1.3-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.6-2.5-1.5M12 6.5V8m0 8v1.5" />
    </svg>
  );
}
function SignOutIcon() {
  return (
    <svg {...icon}>
      <path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14M10 8l-4 4 4 4M6 12h9" />
    </svg>
  );
}
