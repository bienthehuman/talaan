import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SessionUser } from "../auth/session";
import { applyTheme, getStoredTheme, type ThemeChoice } from "../theme/theme";
import styles from "./AccountMenu.module.css";

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  {
    value: "system",
    label: "System",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </>
    ),
  },
  {
    value: "light",
    label: "Light",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  { value: "dark", label: "Dark", icon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /> },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The header's account control (docs/DESIGN_SYSTEM.md section 3): one button that opens a panel with who
 *  is signed in, the theme as three plain choices, and Sign out. Signed out, it holds only the theme.
 *  A disclosure, not an ARIA menu: the panel holds a radio group and a button, and Tab moves through it. */
export function AccountMenu({
  user,
  onSignOut,
}: {
  user?: SessionUser | null;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(getStoredTheme);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const current = THEMES.find((t) => t.value === theme)!;
  return (
    <div className={styles.root} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={user ? undefined : "Display settings"}
        onClick={() => setOpen((o) => !o)}
      >
        {user ? (
          // The initial is drawn by CSS so the button's visible text is just the name.
          <span
            className={styles.avatar}
            data-initial={user.username.slice(0, 1).toUpperCase()}
            aria-hidden="true"
          />
        ) : (
          <span className={styles.themeIcon}>
            <Icon>{current.icon}</Icon>
          </span>
        )}
        {user && (
          <span className={styles.name}>
            <span className="sr-only">Account: </span>
            {user.username}
          </span>
        )}
        <span className={styles.chevron}>
          <Icon>
            <path d="m6 9 6 6 6-6" />
          </Icon>
        </span>
      </button>
      {open && (
        <div id={panelId} className={styles.panel}>
          {user && (
            <div className={styles.who}>
              <span className={styles.avatar} aria-hidden="true">
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div className={styles.whoName}>{user.username}</div>
                <div className={styles.whoRole}>
                  {user.role === "admin" ? "Admin" : "Field worker"}
                </div>
              </div>
            </div>
          )}
          <fieldset className={`field field--choice ${styles.theme}`}>
            <legend>Theme</legend>
            <div className="segmented">
              {THEMES.map((t) => (
                <label key={t.value} className="choice">
                  <input
                    type="radio"
                    name={`${panelId}-theme`}
                    value={t.value}
                    checked={theme === t.value}
                    onChange={() => {
                      applyTheme(t.value);
                      setTheme(t.value);
                    }}
                  />
                  <Icon>{t.icon}</Icon>
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
          {user && onSignOut && (
            <button
              type="button"
              className={styles.signOut}
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              <Icon>
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
              </Icon>
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
