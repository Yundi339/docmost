import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import React from "react";
import useUserRole from "@/hooks/use-user-role.tsx";
import LicenseDetails from "@/ee/licence/components/license-details.tsx";
import ActivateLicenseForm from "@/ee/licence/components/activate-license-modal.tsx";
import InstallationDetails from "@/ee/licence/components/installation-details.tsx";
import OssDetails from "@/ee/licence/components/oss-details.tsx";
import { useAtom } from "jotai/index";
import { entitlementAtom } from "@/ee/entitlement/entitlement-atom";
import { useTranslation } from "react-i18next";

export default function License() {
  const { t } = useTranslation();
  const [entitlements] = useAtom(entitlementAtom);
  const hasLicense = entitlements != null && entitlements.tier !== "free";
  const { isOwner } = useUserRole();

  if (!isOwner) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>{t("License")} - {getAppName()}</title>
      </Helmet>
      <SettingsTitle title={t("License")} />

      <ActivateLicenseForm />

      <InstallationDetails />

      {hasLicense ? <LicenseDetails /> : <OssDetails />}
    </>
  );
}
