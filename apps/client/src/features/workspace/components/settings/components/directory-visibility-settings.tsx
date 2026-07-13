import { Select } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { updateWorkspace } from "@/features/workspace/services/workspace-service";
import { DirectoryVisibility } from "@/features/workspace/types/workspace.types";

const DIRECTORY_VISIBILITIES: DirectoryVisibility[] = [
  "workspace",
  "context",
  "admins-only",
];

export default function DirectoryVisibilitySettings() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [isUpdating, setIsUpdating] = useState(false);
  const value = workspace?.settings?.directory?.visibility ?? "workspace";

  const handleChange = async (next: string | null) => {
    if (!next || next === value) return;
    setIsUpdating(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        directoryVisibility: next as DirectoryVisibility,
      });
      setWorkspace(updatedWorkspace);
      notifications.show({ message: t("Member directory updated") });
    } catch (error) {
      notifications.show({
        message:
          error?.response?.data?.message ??
          t("Failed to update member directory"),
        color: "red",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Select
      label={t("Member directory visibility")}
      value={value}
      data={DIRECTORY_VISIBILITIES.map((visibility) => ({
        value: visibility,
        label: t(
          visibility === "workspace"
            ? "Workspace members"
            : visibility === "context"
              ? "Current page or space"
              : "Administrators only",
        ),
      }))}
      onChange={handleChange}
      disabled={isUpdating}
      allowDeselect={false}
      w={{ base: "100%", sm: 360 }}
    />
  );
}
