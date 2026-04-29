import api from "@/lib/api-client";
import { IPageVisitor } from "@/features/page-visitors/types/page-visitor.types";
import { IPagination } from "@/lib/types.ts";

export async function getPageVisitorList(
  pageId: string,
  cursor?: string,
): Promise<IPagination<IPageVisitor>> {
  const req = await api.post("/pages/visitors", {
    pageId,
    cursor,
  });
  return req.data;
}
