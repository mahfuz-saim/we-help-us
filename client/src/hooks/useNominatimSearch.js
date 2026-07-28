/**
 * useNominatimSearch — debounced free-text lookup against OpenStreetMap.
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * caps requests at 1 per second per IP. We bake the 1-second debounce
 * into this hook so callers can't accidentally trip the limit by typing.
 *
 * Module 2.2.
 *
 * Notes:
 *   - We default to `countrycodes=bd` so the search is biased toward
 *     Bangladesh. The dropdown shows whatever Nominatim returns — it's
 *     an address, not an administrative hierarchy.
 *   - Results are normalised to `{ id, displayName, lat, lng, raw }`
 *     so the AreaSelector's "click to fill" UX stays simple.
 *   - Network failures surface a friendly message; we never crash the
 *     page if Nominatim is unreachable.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE_MS = 1000; // 1 second — Nominatim's policy floor
const MIN_QUERY_LENGTH = 3;

async function searchNominatim(query, signal) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '8');
  url.searchParams.set('countrycodes', 'bd');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Search failed (${res.status})`);
  }
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map((r) => ({
    id: String(r.place_id ?? `${r.lat},${r.lon}`),
    displayName: r.display_name || '',
    lat: Number(r.lat),
    lng: Number(r.lon),
    raw: r,
  }));
}

/**
 * Debounced Nominatim search.
 *
 * @param {string} rawQuery - The text the user is typing.
 * @returns {object} { results, isLoading, error, queryTooShort }
 */
export function useNominatimSearch(rawQuery) {
  const [debounced, setDebounced] = useState(rawQuery);
  const [queryTooShort, setQueryTooShort] = useState(false);

  useEffect(() => {
    const trimmed = (rawQuery || '').trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setQueryTooShort(true);
      // No fetch — but keep debounced so the previous result stays
      // visible until the user starts a new valid query.
      return undefined;
    }
    setQueryTooShort(false);
    const handle = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  const shouldFetch = !queryTooShort && Boolean(debounced);

  const { data, isFetching, error } = useQuery({
    queryKey: ['nominatim', debounced],
    enabled: shouldFetch,
    staleTime: 60 * 60 * 1000, // 1 hour — Nominatim results don't move quickly
    queryFn: ({ signal }) => searchNominatim(debounced, signal),
  });

  return {
    results: shouldFetch ? data || [] : [],
    isLoading: shouldFetch && isFetching,
    error: shouldFetch ? error : null,
    queryTooShort,
  };
}