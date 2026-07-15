import {
  keepPreviousData,
  useQuery,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  searchAttachments,
  searchPage,
  searchShare,
  searchSuggestions,
} from "@/features/search/services/search-service";
import {
  IAttachmentSearch,
  IPageSearch,
  IPageSearchParams,
  ISuggestionResult,
  SearchSuggestionParams,
} from "@/features/search/types/search.types";
import { isAxiosError } from "axios";

export function shouldRetrySearchSuggestions(
  failureCount: number,
  error: Error,
) {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status && status >= 400 && status < 500) return false;
  }

  return failureCount < 1;
}

export function getSearchSuggestionsQueryKey(params: SearchSuggestionParams) {
  return ["search-suggestion", params] as const;
}

export function usePageSearchQuery(
  params: IPageSearchParams,
): UseQueryResult<IPageSearch[], Error> {
  return useQuery({
    queryKey: ["page-search", params],
    queryFn: () => searchPage(params),
    enabled: !!params.query,
  });
}

export function useSearchSuggestionsQuery(
  params: SearchSuggestionParams & { preload?: boolean; enabled?: boolean },
): UseQueryResult<ISuggestionResult, Error> {
  const { preload, enabled = true, ...queryParams } = params;
  return useQuery({
    queryKey: getSearchSuggestionsQueryKey(queryParams),
    staleTime: preload && !queryParams.query.trim() ? 5 * 60 * 1000 : 60 * 1000,
    queryFn: () => searchSuggestions(queryParams),
    enabled: enabled && (preload || Boolean(queryParams.query.trim())),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: shouldRetrySearchSuggestions,
  });
}

export function useShareSearchQuery(
  params: IPageSearchParams,
): UseQueryResult<IPageSearch[], Error> {
  return useQuery({
    queryKey: ["share-search", params],
    queryFn: () => searchShare(params),
    enabled: !!params.query,
    retry: false,
  });
}

export function useAttachmentSearchQuery(
  params: IPageSearchParams,
): UseQueryResult<IAttachmentSearch[], Error> {
  return useQuery({
    queryKey: ["attachment-search", params],
    queryFn: () => searchAttachments(params),
    enabled: !!params.query,
  });
}
