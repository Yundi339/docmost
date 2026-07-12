import {
  Button,
  Center,
  Container,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { unlockShare } from "@/features/share/services/share-service.ts";
import { useQueryClient } from "@tanstack/react-query";
import {
  getShareErrorCode,
  SHARE_PASSWORD_INVALID,
} from "@/features/share/share-errors.ts";

interface SharePasswordPromptProps {
  shareId?: string;
  pageId?: string;
}

export function SharePasswordPrompt({
  shareId,
  pageId,
}: SharePasswordPromptProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const queryClient = useQueryClient();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await unlockShare({ shareId, pageId, password });
      await queryClient.invalidateQueries({
        predicate: (item) =>
          [
            "share-by-id",
            "shares",
            "shared-page-tree",
            "share-search",
          ].includes(item.queryKey[0] as string),
      });
    } catch (requestError) {
      setError(
        getShareErrorCode(requestError) === SHARE_PASSWORD_INVALID
          ? t("Incorrect password")
          : t("Unable to unlock this shared page"),
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Center mih="calc(100vh - 100px)" px="md">
      <Container size={420} w="100%" p={0}>
        <form onSubmit={submit}>
          <Stack gap="md">
            <IconLock size={32} stroke={1.5} aria-hidden />
            <div>
              <Title order={2} fz="h3">
                {t("Password required")}
              </Title>
              <Text size="sm" c="dimmed" mt={4}>
                {t("Enter the password to view this shared page.")}
              </Text>
            </div>
            <PasswordInput
              label={t("Password")}
              value={password}
              maxLength={128}
              autoFocus
              autoComplete="current-password"
              error={error}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <Button type="submit" loading={isPending} disabled={!password}>
              {t("Unlock")}
            </Button>
          </Stack>
        </form>
      </Container>
    </Center>
  );
}
