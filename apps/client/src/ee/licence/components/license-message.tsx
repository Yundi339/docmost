import { useTranslation } from "react-i18next";

export default function LicenseMessage() {
  const { t } = useTranslation();
  return <>{t("To unlock enterprise features, please contact your administrator.")}</>;
}
