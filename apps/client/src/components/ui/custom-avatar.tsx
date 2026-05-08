import React from "react";
import { Avatar } from "@mantine/core";
import { getAvatarUrl } from "@/lib/config.ts";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";

interface CustomAvatarProps {
  avatarUrl?: string;
  name: string;
  color?: string;
  size?: string | number;
  radius?: string | number;
  variant?: string;
  style?: any;
  component?: any;
  type?: AvatarIconType;
  mt?: string | number;
}

function sanitizeInitialsSource(name: string) {
  const sanitized = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  return sanitized || name;
}

export const CustomAvatar = React.forwardRef<
  HTMLInputElement,
  CustomAvatarProps
>(({ avatarUrl, name, type, ...props }: CustomAvatarProps, ref) => {
  const avatarLink = getAvatarUrl(avatarUrl, type);
  const initialsSource = sanitizeInitialsSource(name ?? "");

  return (
    <Avatar
      ref={ref}
      src={avatarLink}
      name={initialsSource}
      alt={name}
      color="initials"
      {...props}
    />
  );
});
