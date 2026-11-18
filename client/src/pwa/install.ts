import { useCallback, useEffect, useState } from "react";

/** The browser's install event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "talaan.installDismissed";

function isInstalled(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Offer to install the app. The browser only fires its event when installing is possible, so the
 *  prompt never shows where it cannot work, and never once the app runs installed. A "Not now" is
 *  remembered, so the question is not asked on every visit. */
export function useInstallPrompt(): {
  canInstall: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
} {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => isInstalled() || wasDismissed());

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own button
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setEvent(null);
      setHidden(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // not remembered, which only means it may ask again
    }
    setHidden(true);
  }, []);

  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    setEvent(null); // the browser allows one prompt per event
    if (outcome === "dismissed") dismiss();
    else setHidden(true);
  }, [event, dismiss]);

  return { canInstall: event !== null && !hidden, install, dismiss };
}
