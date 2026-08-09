"use client";

import { useState } from "react";
import { apiFetch } from "./api-client";
import { usePolling } from "./hooks";
import type { PaginatedResponse } from "./types";

/**
 * First page polls every 10s (doc-04 "realtime-ish"); "Load more" appends static pages.
 * Pass `baseUrl: null` to pause polling entirely (e.g. a "Live: Off" toggle).
 */
export function usePaginatedList<T>(baseUrl: string | null) {
  const [extraPages, setExtraPages] = useState<{ data: T[]; nextCursor: string | null }[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prevBaseUrl, setPrevBaseUrl] = useState(baseUrl);

  const { data: firstPage, error, isLoading, mutate } = usePolling<PaginatedResponse<T>>(baseUrl);

  // Reset accumulated pages when the filter-derived URL changes (React-recommended pattern:
  // adjust state during render on a prop change, rather than in an effect).
  if (prevBaseUrl !== baseUrl) {
    setPrevBaseUrl(baseUrl);
    setExtraPages([]);
  }

  const cursor =
    extraPages.length > 0
      ? extraPages[extraPages.length - 1].nextCursor
      : (firstPage?.nextCursor ?? null);

  async function loadMore() {
    if (!cursor || !baseUrl) return;
    setLoadingMore(true);
    try {
      const sep = baseUrl.includes("?") ? "&" : "?";
      const page = await apiFetch<PaginatedResponse<T>>(`${baseUrl}${sep}cursor=${cursor}`);
      setExtraPages((prev) => [...prev, { data: page.data, nextCursor: page.nextCursor }]);
    } finally {
      setLoadingMore(false);
    }
  }

  const items = firstPage ? [...firstPage.data, ...extraPages.flatMap((p) => p.data)] : undefined;

  return {
    items,
    total: firstPage?.total,
    error,
    isLoading,
    mutate,
    nextCursor: cursor,
    loadMore,
    loadingMore,
  };
}
