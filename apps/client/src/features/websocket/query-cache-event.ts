import type { QueryClient } from "@tanstack/react-query";
import type {
  InvalidateEvent,
  RemoveQueryEvent,
} from "@/features/websocket/types";

export function applyQueryCacheEvent(
  queryClient: QueryClient,
  data: InvalidateEvent | RemoveQueryEvent,
) {
  const queryKey = data.id ? [...data.entity, data.id] : data.entity;
  if (data.operation === "removeQuery") {
    queryClient.removeQueries({ queryKey, exact: true });
    return;
  }

  void queryClient.invalidateQueries({ queryKey });
}
