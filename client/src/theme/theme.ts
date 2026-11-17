export type ThemeChoice = "system" | "light" | "dark";

const KEY = "talaan.theme";

export function getStoredTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // storage blocked: fall through to system
  }
  return "system";
}

/** Sets or clears `data-theme` on <html>. "system" removes it so prefers-color-scheme decides. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // not persisted; still applied for this session
  }
}

export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return choice === "system" ? "light" : choice === "light" ? "dark" : "system";
}
