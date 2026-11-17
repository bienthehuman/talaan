import { useRegisterSW } from "virtual:pwa-register/react";
import { Banner } from "./Banner";
import { Button } from "./Button";

/** Service worker registration. A new version waits until the user agrees, so the running app is
 *  never swapped out mid-sync (docs/ARCHITECTURE.md; registerType "prompt"). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <Banner
      kind="info"
      action={
        <>
          <Button small onClick={() => updateServiceWorker(true)}>
            Update now
          </Button>
          <Button small variant="secondary" onClick={() => setNeedRefresh(false)}>
            Later
          </Button>
        </>
      }
    >
      A new version of Talaan is ready.
    </Banner>
  );
}
