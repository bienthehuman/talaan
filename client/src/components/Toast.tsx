import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./Button";
import styles from "./Toast.module.css";

type Kind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}
interface ToastApi {
  show: (message: string, kind?: Kind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: Kind = "info") => {
      const id = next.current++;
      setItems((list) => [...list, { id, kind, message }]);
      // Errors stay until dismissed; others clear themselves.
      if (kind !== "error") setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.toasts}>
        {/* An error is announced at once; other toasts wait for a pause. Each list keeps its own region. */}
        <div className={styles.list}>
          {items
            .filter((t) => t.kind === "error")
            .map((t) => (
              <div key={t.id} className={`${styles.toast} ${styles.error}`} role="alert">
                <ToastBody item={t} onDismiss={dismiss} />
              </div>
            ))}
        </div>
        <div className={styles.list} role="status" aria-live="polite">
          {items
            .filter((t) => t.kind !== "error")
            .map((t) => (
              <div
                key={t.id}
                className={
                  t.kind === "success" ? `${styles.toast} ${styles.success}` : styles.toast
                }
              >
                <ToastBody item={t} onDismiss={dismiss} />
              </div>
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastBody({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  return (
    <>
      {item.message}{" "}
      <Button variant="secondary" small onClick={() => onDismiss(item.id)}>
        Dismiss
      </Button>
    </>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
