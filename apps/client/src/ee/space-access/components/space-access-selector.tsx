import {
  Loader,
  MultiSelect,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  ISpaceAccessSpace,
  SpaceAccessInput,
} from "@/ee/space-access/types/space-access.types";

interface SpaceAccessSelectorProps {
  value: SpaceAccessInput;
  onChange: (value: SpaceAccessInput) => void;
  spaces: ISpaceAccessSpace[];
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
}

export function SpaceAccessSelector({
  value,
  onChange,
  spaces,
  label,
  description,
  error,
  disabled = false,
  loading = false,
}: SpaceAccessSelectorProps) {
  const { t } = useTranslation();
  const selectedError =
    value.mode === "selected" && value.spaceIds.length === 0
      ? t("Select at least one space.")
      : undefined;
  const options = spaces.map((space) => ({
    value: space.id,
    label: `${space.name} (${space.slug})`,
  }));

  return (
    <Stack gap={6}>
      <div>
        <Text size="sm" fw={500}>
          {label ?? t("Space access")}
        </Text>
        {description && (
          <Text size="xs" c="dimmed" mt={2}>
            {description}
          </Text>
        )}
      </div>

      <SegmentedControl
        fullWidth
        value={value.mode}
        disabled={disabled}
        data={[
          { value: "all", label: t("All spaces") },
          { value: "selected", label: t("Specific spaces") },
        ]}
        onChange={(mode) =>
          onChange(
            mode === "selected"
              ? { mode: "selected", spaceIds: [] }
              : { mode: "all" },
          )
        }
      />

      {value.mode === "selected" && (
        <MultiSelect
          label={t("Select spaces")}
          placeholder={t("Search spaces...")}
          data={options}
          value={value.spaceIds}
          onChange={(spaceIds) => onChange({ mode: "selected", spaceIds })}
          searchable
          clearable
          maxValues={200}
          required
          disabled={disabled || loading}
          rightSection={loading ? <Loader size={16} /> : undefined}
          nothingFoundMessage={t("No spaces found")}
          error={error || selectedError}
        />
      )}
    </Stack>
  );
}
