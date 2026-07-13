import { Group, SelectProps, Text } from "@mantine/core";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { IDirectoryUser } from "@/features/search/types/search.types";

export const MAX_VERIFIERS = 5;

export type UserOptionItem = {
  value: string;
  label: string;
  email?: string;
  avatarUrl?: string;
};

export function toUserOptions(
  users: IDirectoryUser[] | undefined,
): UserOptionItem[] {
  return (users ?? []).map((user) => ({
    value: user.id,
    label: user.name,
    avatarUrl: user.avatarUrl,
  }));
}

export const renderUserSelectOption: SelectProps["renderOption"] = ({
  option,
}) => (
  <Group gap="sm" wrap="nowrap">
    <CustomAvatar
      avatarUrl={option["avatarUrl"]}
      size={20}
      name={option.label}
    />
    <div>
      <Text size="sm" lineClamp={1}>
        {option.label}
      </Text>
      {option["email"] && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {option["email"]}
        </Text>
      )}
    </div>
  </Group>
);
