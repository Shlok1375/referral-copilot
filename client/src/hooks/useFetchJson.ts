import { useEffect, useState } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches JSON from `url` whenever it changes, handling loading state,
 * error normalization, and request cancellation (so a stale response
 * from a superseded request can never overwrite fresher data).
 *
 * Pass `null` for `url` to skip fetching (e.g. while a required filter
 * is unset) — `data` is cleared and `loading`/`error` reset to idle.
 */
export function useFetchJson<T>(url: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: url != null, error: null });

  useEffect(() => {
    if (url == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting to idle when the URL becomes null is a one-time synchronization, not a derived value computable during render.
      setState({ data: null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState((prev) => ({ data: prev.data, loading: true, error: null }));

    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText || `Request failed (${r.status})`);
        return r.json() as Promise<T>;
      })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setState({ data: null, loading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      });

    return () => controller.abort();
  }, [url]);

  return state;
}
