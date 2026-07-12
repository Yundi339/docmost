import { useEffect, useState } from "react";
import { Button, Divider } from "@mantine/core";
import { IconFingerprint } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import useAuth from "@/features/auth/hooks/use-auth";
import { usePasskeyStatusQuery } from "@/ee/passkey/queries/passkey-query";
import {
  getPasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
} from "@/ee/passkey/services/passkey-service";
import {
  abortPasskeyCeremony,
  browserSupportsPasskeys,
  isPasskeyCancellation,
  startPasskeyAuthentication,
} from "@/ee/passkey/lib/passkey-browser";

export function PasskeyLoginButton() {
  const { t } = useTranslation();
  const { continueAfterPrimaryAuth } = useAuth();
  const { data: status } = usePasskeyStatusQuery();
  const [loading, setLoading] = useState(false);

  useEffect(() => abortPasskeyCeremony, []);

  if (!status?.available || !browserSupportsPasskeys()) return null;

  async function loginWithPasskey() {
    setLoading(true);
    try {
      const ceremony = await getPasskeyAuthenticationOptions();
      const credential = await startPasskeyAuthentication(ceremony.options);
      const result = await verifyPasskeyAuthentication({
        challengeId: ceremony.challengeId,
        credential,
      });
      continueAfterPrimaryAuth(result);
    } catch (error) {
      if (!isPasskeyCancellation(error)) {
        notifications.show({
          message:
            error?.["response"]?.data?.message ||
            t("Passkey authentication failed"),
          color: "red",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Divider my="md" label={t("or")} labelPosition="center" />
      <Button
        type="button"
        variant="default"
        fullWidth
        leftSection={<IconFingerprint size={18} />}
        loading={loading}
        onClick={loginWithPasskey}
      >
        {t("Sign in with a passkey")}
      </Button>
    </>
  );
}
