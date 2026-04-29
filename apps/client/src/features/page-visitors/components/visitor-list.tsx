import { useEffect, useMemo, useRef } from "react";
import {
  ScrollArea,
  Center,
  Loader,
  Stack,
  Text,
  Group,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { usePageVisitorListQuery } from "@/features/page-visitors/queries/page-visitor-query";
import VisitorItem from "@/features/page-visitors/components/visitor-item";

interface Props {
  pageId: string;
}

export default function VisitorList({ pageId }: Props) {
  const { t } = useTranslation();
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePageVisitorListQuery(pageId);

  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  );

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (isLoading) {
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  }

  if (isError) {
    return (
      <Center py="xl">
        <Text c="red">{t("Error loading visitors.")}</Text>
      </Center>
    );
  }

  if (items.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">{t("No visitors recorded yet.")}</Text>
      </Center>
    );
  }

  return (
    <ScrollArea h={520} type="auto">
      <Stack gap={0}>
        {items.map((visitor) => (
          <VisitorItem key={visitor.id} visitor={visitor} />
        ))}
        <Group ref={sentinelRef} justify="center" py="md">
          {isFetchingNextPage && <Loader size="xs" />}
        </Group>
      </Stack>
    </ScrollArea>
  );
}
