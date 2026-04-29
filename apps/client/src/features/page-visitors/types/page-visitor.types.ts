export interface IPageVisitorUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  deactivatedAt: string | null;
}

export interface IPageVisitor {
  id: string;
  pageId: string;
  userId: string;
  firstVisitedAt: string;
  lastVisitedAt: string;
  visitCount: number;
  // Null when the underlying user has been hard-deleted.
  user: IPageVisitorUser | null;
}
