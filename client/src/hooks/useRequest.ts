import { useCallback, useEffect, useState } from "react";

interface State<T> {
  key: string;
  data?: T;
  error?: unknown;
}

/** Run an async request when `deps` change. `loading` is derived from the answer not matching the
 *  current request yet, so there is no flash of stale data and nothing to reset. */
export function useRequest<T>(
  run: () => Promise<T>,
  deps: unknown[],
): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [reloads, setReloads] = useState(0);
  const key = `${JSON.stringify(deps)}#${reloads}`;
  const [state, setState] = useState<State<T>>({ key: "" });

  useEffect(() => {
    let current = true;
    run().then(
      (data) => current && setState({ key, data }),
      (error) => current && setState({ key, error }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const answered = state.key === key;
  return {
    data: answered ? state.data : undefined,
    error: answered ? state.error : undefined,
    loading: !answered,
    reload,
  };
}
