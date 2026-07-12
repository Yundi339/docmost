import { Skeleton, Space, Tabs, Text } from "@mantine/core";
import {
  IconClockHour3,
  IconStar,
  IconTopologyStar,
  IconUser,
} from "@tabler/icons-react";
import { lazy, Suspense } from "react";
import RecentChanges from "@/components/common/recent-changes";
import FavoritesPages from "@/features/home/components/favorites-pages";
import CreatedByMe from "@/features/home/components/created-by-me";
import { useParams } from "react-router-dom";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import { spaceHomeTabAtom } from "@/features/space/atoms/space-home-tab-atom";

const SpaceGraphView = lazy(
  () => import("@/features/space/graph/space-graph-view"),
);

export default function SpaceHomeTabs() {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const [activeTab, setActiveTab] = useAtom(spaceHomeTabAtom);

  return (
    <Tabs
      color="dark"
      value={activeTab}
      onChange={(value) => {
        if (value) setActiveTab(value);
      }}
    >
      <Tabs.List style={{ flexWrap: "nowrap", overflowX: "auto" }}>
        <Tabs.Tab value="recent" leftSection={<IconClockHour3 size={18} />}>
          <Text size="sm" fw={500}>
            {t("Recently updated")}
          </Text>
        </Tabs.Tab>
        <Tabs.Tab value="favorites" leftSection={<IconStar size={18} />}>
          <Text size="sm" fw={500}>
            {t("Favorites")}
          </Text>
        </Tabs.Tab>
        <Tabs.Tab value="created" leftSection={<IconUser size={18} />}>
          <Text size="sm" fw={500}>
            {t("Created by me")}
          </Text>
        </Tabs.Tab>
        <Tabs.Tab value="graph" leftSection={<IconTopologyStar size={18} />}>
          <Text size="sm" fw={500}>
            {t("Graph")}
          </Text>
        </Tabs.Tab>
      </Tabs.List>

      <Space my="md" />

      <Tabs.Panel value="recent">
        {space?.id && <RecentChanges spaceId={space.id} />}
      </Tabs.Panel>
      <Tabs.Panel value="favorites">
        {space?.id && <FavoritesPages spaceId={space.id} />}
      </Tabs.Panel>
      <Tabs.Panel value="created">
        {space?.id && <CreatedByMe spaceId={space.id} />}
      </Tabs.Panel>
      <Tabs.Panel value="graph">
        {activeTab === "graph" && space?.id && (
          <Suspense fallback={<Skeleton h={420} />}>
            <SpaceGraphView space={space} />
          </Suspense>
        )}
      </Tabs.Panel>
    </Tabs>
  );
}
