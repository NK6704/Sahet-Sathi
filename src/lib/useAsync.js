import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The brief asks for a loading, an empty and an error state on every
 * screen. Doing that by hand eleven times is how one of them ends up
 * missing, so it lives here instead.
 *
 * Returns { data, error, loading, reload, setData }. `setData` is for
 * optimistic updates — a worker who taps "Acknowledge" on a weak
 * signal should see it change immediately.
 *
 * `loading` is DERIVED, not stored: it is true until the fetch for the
 * current deps has settled. Storing it in state let a frame slip
 * through where the deps had just changed but the effect had not run
 * yet, and in that frame the screen said "No alerts here" to a worker
 * who has six. Deriving it makes that gap impossible.
 *
 * Deps are expected to be scalars (ids, filter strings). Objects
 * stringify to the same key and will not retrigger.
 */
export function useAsync(fn, deps = [], { skip = false } = {}) {
  const [nonce, setNonce] = useState(0);
  const depKey = `${nonce}|${deps.map((d) => (d === undefined ? '∅' : String(d))).join('|')}`;

  const [state, setState] = useState({ data: null, error: null, settledKey: null });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (skip) return;

    let cancelled = false;
    const settle = (patch) => {
      if (cancelled || !alive.current) return;
      setState((prev) => ({ ...prev, ...patch, settledKey: depKey }));
    };

    Promise.resolve()
      .then(fn)
      .then((res) => settle({ data: res, error: null }))
      .catch((e) => settle({ error: e }));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, skip]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (next) =>
      setState((prev) => ({
        ...prev,
        data: typeof next === 'function' ? next(prev.data) : next,
      })),
    [],
  );

  return {
    data: state.data,
    error: state.error,
    // Skipped calls are not loading — they are waiting on something
    // else, and the caller decides what to show meanwhile.
    loading: !skip && state.settledKey !== depKey,
    reload,
    setData,
  };
}
