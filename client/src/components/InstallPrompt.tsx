import { useInstallPrompt } from "../pwa/install";
import { Banner } from "./Banner";
import { Button } from "./Button";

export function InstallPrompt() {
  const { canInstall, install, dismiss } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <Banner
      kind="info"
      action={
        <>
          <Button small onClick={() => void install()}>
            Install
          </Button>
          <Button small variant="secondary" onClick={dismiss}>
            Not now
          </Button>
        </>
      }
    >
      Install Talaan on this device to open it like an app. Your data is also safer from being
      cleared.
    </Banner>
  );
}
