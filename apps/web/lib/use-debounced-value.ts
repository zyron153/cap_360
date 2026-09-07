import { useEffect, useState } from "react";

/**
 * Returns `value` delayed by `delayMs`, so a fast-changing source (a search box firing on every
 * keystroke) can drive a network request without one request per character.
 *
 * Typical use: keep the raw input controlled by its own `useState` (so typing stays instant), pass
 * that state through this hook, and use the debounced result in the React Query key + fetcher.
 *
 * See `Docs/REVIEW.md` §4.2 — search inputs across the app had no debounce.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
