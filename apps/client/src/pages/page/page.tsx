import { useParams } from "react-router-dom";
import { usePageQuery } from "@/features/page/queries/page-query";
import { FullEditor } from "@/features/editor/full-editor";
import HistoryModal from "@/features/page-history/components/history-modal";
import VisitorsModal from "@/features/page-visitors/components/visitors-modal";
import { Helmet } from "react-helmet-async";
import PageHeader from "@/features/page/components/header/page-header.tsx";
import { extractPageSlugId } from "@/lib";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { useTranslation } from "react-i18next";
import React from "react";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { IconAlertTriangle, IconFileOff } from "@tabler/icons-react";
import { Button, Container, Skeleton, Stack } from "@mantine/core";
import { Link } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
const MemoizedFullEditor = React.memo(FullEditor);
const MemoizedPageHeader = React.memo(PageHeader);
const MemoizedHistoryModal = React.memo(HistoryModal);
const MemoizedVisitorsModal = React.memo(VisitorsModal);

function PageLoadingSkeleton() {
  return (
    <Container size={900} mt="xl">
      <Stack gap="md">
        <Skeleton height={48} width="60%" radius="sm" />
        <Skeleton height={18} width="40%" radius="sm" />
        <Skeleton height={12} mt="xl" radius="sm" />
        <Skeleton height={12} radius="sm" />
        <Skeleton height={12} width="85%" radius="sm" />
        <Skeleton height={12} width="70%" radius="sm" />
        <Skeleton height={12} mt="md" radius="sm" />
        <Skeleton height={12} width="90%" radius="sm" />
        <Skeleton height={12} width="75%" radius="sm" />
      </Stack>
    </Container>
  );
}

export default function Page() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();

  return (
    <ErrorBoundary
      resetKeys={[pageSlug]}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <EmptyState
          icon={IconAlertTriangle}
          title={t("Failed to load page. An error occurred.")}
          description={error instanceof Error ? error.message : String(error)}
          action={
            <Button variant="default" size="sm" mt="xs" onClick={resetErrorBoundary}>
              {t("Try again")}
            </Button>
          }
        />
      )}
    >
      <PageContent pageSlug={pageSlug} />
    </ErrorBoundary>
  );
}

function PageContent({ pageSlug }: { pageSlug: string | undefined }) {
  const { t } = useTranslation();

  const {
    data: page,
    isLoading,
    isError,
    error,
  } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const { data: space } = useGetSpaceBySlugQuery(page?.space?.slug);

  const canEdit = page?.permissions?.canEdit ?? false;
  const canComment =
    canEdit ||
    (space?.settings?.comments?.allowViewerComments === true);

  if (isLoading) {
    return <PageLoadingSkeleton />;
  }

  if (isError || !page) {
    if ([401, 403, 404].includes(error?.["status"])) {
      return (
        <EmptyState
          icon={IconFileOff}
          title={t("Page not found")}
          description={t(
            "This page may have been deleted, moved, or you may not have access.",
          )}
          action={
            <Button component={Link} to="/home" variant="default" size="sm" mt="xs">
              {t("Go to homepage")}
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={IconFileOff}
        title={t("Error fetching page data.")}
      />
    );
  }

  if (!space) {
    return <PageLoadingSkeleton />;
  }

  return (
    page && (
      <div>
        <Helmet>
          <title>{`${page?.icon || ""}  ${page?.title || t("untitled")}`}</title>
        </Helmet>

        <MemoizedPageHeader readOnly={!canEdit} />

        <MemoizedFullEditor
          key={page.id}
          pageId={page.id}
          title={page.title}
          content={page.content}
          slugId={page.slugId}
          spaceSlug={page?.space?.slug}
          editable={canEdit}
          creator={page.creator}
          contributors={page.contributors}
          canComment={canComment}
        />
        <MemoizedHistoryModal pageId={page.id} />
        <MemoizedVisitorsModal pageId={page.id} />
      </div>
    )
  );
}
