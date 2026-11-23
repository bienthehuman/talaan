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
      Install Talaan to open it from your home screen like any other app. It also helps keep your
      saved work safe.
    </Banner>
  );
}
