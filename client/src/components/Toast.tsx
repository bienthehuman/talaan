import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
      <div className="toasts">
        {/* An error is announced at once; other toasts wait for a pause. Each list keeps its own region. */}
        <div className="toast-list">
          {items
            .filter((t) => t.kind === "error")
            .map((t) => (
              <div key={t.id} className="toast toast--error" role="alert">
                <ToastBody item={t} onDismiss={dismiss} />
              </div>
            ))}
        </div>
        <div className="toast-list" role="status" aria-live="polite">
          {items
            .filter((t) => t.kind !== "error")
            .map((t) => (
              <div key={t.id} className={`toast toast--${t.kind}`}>
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
      <button className="btn btn--secondary btn--small" onClick={() => onDismiss(item.id)}>
        Dismiss
      </button>
    </>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
