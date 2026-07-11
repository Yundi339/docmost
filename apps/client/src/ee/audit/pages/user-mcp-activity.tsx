import { useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Space, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import Paginate from "@/components/common/paginate";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { useMyMcpAuditLogsQuery } from "@/ee/audit/queries/audit-query";
import { IAuditLogParams } from "@/ee/audit/types/audit.types";
import AuditLogsTable from "@/ee/audit/components/audit-logs-table";

export default function UserMcpActivity() {
  const { t } = useTranslation();
  const { cursor, goNext, goPrev } = useCursorPaginate();

  const params: IAuditLogParams = useMemo(
    () => ({
      cursor,
      limit: 50,
    }),
    [cursor],
  );

  const { data, isLoading } = useMyMcpAuditLogsQuery(params);

  return (
    <>
      <Helmet>
        <title>
          {t("MCP activity")} - {getAppName()}
        </title>
      </Helmet>

      <SettingsTitle title={t("MCP activity")} />

      <Text size="sm" c="dimmed" mb="md">
        {t("Review activity from your MCP API keys and OAuth connections.")}
      </Text>

      <AuditLogsTable items={data?.items} isLoading={isLoading} />

      <Space h="md" />

      {data?.items && data.items.length > 0 && (
        <Paginate
          hasPrevPage={data?.meta?.hasPrevPage}
          hasNextPage={data?.meta?.hasNextPage}
          onNext={() => goNext(data?.meta?.nextCursor)}
          onPrev={goPrev}
        />
      )}
    </>
  );
}
