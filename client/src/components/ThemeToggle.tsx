import { useState } from "react";
import { applyTheme, getStoredTheme, nextTheme, type ThemeChoice } from "../theme/theme";
import { Button } from "./Button";

const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(getStoredTheme);
  return (
    <Button
      variant="secondary"
      small
      onClick={() => {
        const next = nextTheme(choice);
        applyTheme(next);
        setChoice(next);
      }}
    >
      Theme: {LABEL[choice]}
    </Button>
  );
}
