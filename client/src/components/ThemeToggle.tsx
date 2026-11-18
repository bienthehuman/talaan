import { useState, type ReactNode } from "react";
import { applyTheme, getStoredTheme, nextTheme, type ThemeChoice } from "../theme/theme";
import { Button } from "./Button";
import styles from "./ThemeToggle.module.css";

const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

const ICON: Record<ThemeChoice, ReactNode> = {
  // Half filled: follows the device.
  system: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
};

/** Cycles system → light → dark. On a narrow screen only the icon shows; the name stays "Theme: …". */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(getStoredTheme);
  return (
    <Button
      variant="secondary"
      small
      className={className}
      onClick={() => {
        const next = nextTheme(choice);
        applyTheme(next);
        setChoice(next);
      }}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICON[choice]}
      </svg>
      <span className="wide-only">Theme: {LABEL[choice]}</span>
    </Button>
  );
}
