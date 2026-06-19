import React, { useEffect, useState } from "react";
import { Group, Text, ScrollArea, ActionIcon, Tooltip } from "@mantine/core";
import {
  IconUser,
  IconSettings,
  IconUsers,
  IconArrowLeft,
  IconUsersGroup,
  IconSpaces,
  IconBrush,
  IconCoin,
  IconLock,
  IconKey,
  IconWorld,
  IconSparkles,
  IconHistory,
  IconShieldCheck,
  IconActivity,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router-dom";
import classes from "./settings.module.css";
import { useTranslation } from "react-i18next";
import { isCloud } from "@/lib/config.ts";
import useUserRole from "@/hooks/use-user-role.tsx";
import {
  prefetchApiKeyManagement,
  prefetchApiKeys,
  prefetchBilling,
  prefetchGroups,
  prefetchShares,
  prefetchSpaces,
  prefetchSsoProviders,
  prefetchWorkspaceMembers,
  prefetchAuditLogs,
  prefetchVerifiedPages,
} from "@/components/settings/settings-queries.tsx";
import AppVersion from "@/components/settings/app-version.tsx";
import { useAtom } from "jotai";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import { useSettingsNavigation } from "@/hooks/use-settings-navigation";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";

type DataItem = {
  label: string;
  icon: React.ElementType;
  path: string;
  notImplemented?: boolean;
  role?: "admin" | "owner";
  env?: "cloud" | "selfhosted";
};

type DataGroup = {
  heading: string;
  items: DataItem[];
};

const groupedData: DataGroup[] = [
  {
    heading: "Account",
    items: [
      { label: "Profile", icon: IconUser, path: "/settings/account/profile" },
      {
        label: "Preferences",
        icon: IconBrush,
        path: "/settings/account/preferences",
      },
      {
        label: "API keys",
        icon: IconKey,
        path: "/settings/account/api-keys",
      },
    ],
  },
  {
    heading: "Workspace",
    items: [
      { label: "General", icon: IconSettings, path: "/settings/workspace" },
      {
        label: "Members",
        icon: IconUsers,
        path: "/settings/members",
        role: "admin",
      },
      {
        label: "Billing",
        icon: IconCoin,
        path: "/settings/billing",
        role: "owner",
        env: "cloud",
      },
      {
        label: "Security & SSO",
        icon: IconLock,
        path: "/settings/security",
        role: "admin",
      },
      {
        label: "Groups",
        icon: IconUsersGroup,
        path: "/settings/groups",
        role: "admin",
      },
      { label: "Spaces", icon: IconSpaces, path: "/settings/spaces" },
      { label: "Public sharing", icon: IconWorld, path: "/settings/sharing" },
      {
        label: "Verified pages",
        icon: IconShieldCheck,
        path: "/settings/verifications",
      },
      {
        label: "API management",
        icon: IconKey,
        path: "/settings/api-keys",
        role: "admin",
      },
      {
        label: "AI settings",
        icon: IconSparkles,
        path: "/settings/ai",
      },
      {
        label: "Audit log",
        icon: IconHistory,
        path: "/settings/audit",
        role: "owner",
      },
      {
        label: "System Status",
        icon: IconActivity,
        path: "/settings/system-status",
        role: "owner",
      },
    ],
  },
];

export default function SettingsSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [active, setActive] = useState(location.pathname);
  const { goBack } = useSettingsNavigation();
  const { isAdmin, isOwner } = useUserRole();
  const [workspace] = useAtom(workspaceAtom);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);

  useEffect(() => {
    setActive(location.pathname);
  }, [location.pathname]);

  const canShowItem = (item: DataItem) => {
    if (item.env === "cloud" && !isCloud()) return false;
    if (item.env === "selfhosted" && isCloud()) return false;
    if (
      item.label === "AI settings" &&
      !isAdmin &&
      workspace?.settings?.ai?.allowMemberSettings === false
    ) {
      return false;
    }
    if (item.role === "admin" && !isAdmin) return false;
    if (item.role === "owner" && !isOwner) return false;
    return true;
  };

  const menuItems = groupedData.map((group) => {
    return (
      <div key={group.heading}>
        <Text c="dimmed" className={classes.linkHeader}>
          {t(group.heading)}
        </Text>
        {group.items.map((item) => {
          if (!canShowItem(item)) {
            return null;
          }

          let prefetchHandler: any;
          switch (item.label) {
            case "Members":
              prefetchHandler = prefetchWorkspaceMembers;
              break;
            case "Spaces":
              prefetchHandler = prefetchSpaces;
              break;
            case "Groups":
              prefetchHandler = prefetchGroups;
              break;
            case "Billing":
              prefetchHandler = prefetchBilling;
              break;
            case "Security & SSO":
              prefetchHandler = prefetchSsoProviders;
              break;
            case "Public sharing":
              prefetchHandler = prefetchShares;
              break;
            case "API keys":
              prefetchHandler = prefetchApiKeys;
              break;
            case "API management":
              prefetchHandler = isAdmin
                ? prefetchApiKeyManagement
                : prefetchApiKeys;
              break;
            case "Audit log":
              prefetchHandler = prefetchAuditLogs;
              break;
            case "Verified pages":
              prefetchHandler = prefetchVerifiedPages;
              break;
            default:
              break;
          }

          const isDisabled = !!item.notImplemented;

          if (isDisabled) {
            return (
              <Tooltip
                key={item.label}
                label={t("Not implemented yet")}
                position="right"
                withArrow
              >
                <span
                  className={classes.link}
                  data-disabled
                  role="link"
                  aria-disabled="true"
                  tabIndex={0}
                  style={{
                    opacity: 0.5,
                    cursor: "not-allowed",
                  }}
                >
                  <item.icon className={classes.linkIcon} stroke={2} />
                  <span>{t(item.label)}</span>
                </span>
              </Tooltip>
            );
          }

          return (
            <Link
              onMouseEnter={prefetchHandler}
              className={classes.link}
              data-active={active.startsWith(item.path) || undefined}
              key={item.label}
              to={item.path}
              onClick={() => {
                if (mobileSidebarOpened) {
                  toggleMobileSidebar();
                }
              }}
            >
              <item.icon className={classes.linkIcon} stroke={2} />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
      </div>
    );
  });

  return (
    <div className={classes.navbar}>
      <Group className={classes.title} justify="flex-start">
        <ActionIcon
          onClick={() => {
            goBack();
            if (mobileSidebarOpened) {
              toggleMobileSidebar();
            }
          }}
          variant="transparent"
          c="gray"
          aria-label={t("Back")}
        >
          <IconArrowLeft stroke={2} />
        </ActionIcon>
        <Text fw={500}>{t("Settings")}</Text>
      </Group>

      <ScrollArea w="100%" style={{ overscrollBehavior: "contain" }}>
        {menuItems}
      </ScrollArea>

      {!isCloud() && <AppVersion />}
    </div>
  );
}
