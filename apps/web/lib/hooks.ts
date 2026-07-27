import useSWR, { type SWRConfiguration } from "swr";
import { apiFetch } from "./api-client";

export function usePolling<T>(key: string | null, opts?: SWRConfiguration) {
  return useSWR<T>(key, (url: string) => apiFetch<T>(url), {
    refreshInterval: 10_000,
    revalidateOnFocus: false,
    ...opts,
  });
}
