import { Alert } from "@mantine/core";
import { useBillingQuery } from "@/ee/billing/queries/billing-query.ts";
import useTrial from "@/ee/hooks/use-trial.tsx";
import { getBillingTrialDays } from '@/lib/config.ts';
import { useTranslation } from "react-i18next";

export default function BillingTrial() {
  const { data: billing, isLoading } = useBillingQuery();
  const { trialDaysLeft } = useTrial();
  const { t } = useTranslation();

  if (isLoading) {
    return null;
  }

  return (
    <>
      {trialDaysLeft > 0 && !billing && (
        <Alert title={t("Your Trial is Active 🎉")} color="blue" radius="md">
          {t("You have {{daysLeft}} {{dayUnit}} left in your {{trialDays}}-day free trial. Please subscribe to a paid plan before your trial ends.", { daysLeft: trialDaysLeft, dayUnit: trialDaysLeft === 1 ? t("day") : t("days"), trialDays: getBillingTrialDays() })}
        </Alert>
      )}

      {trialDaysLeft === 0 && (
        <Alert title={t("Your Trial has ended")} color="red" radius="md">
          {t("Your {{trialDays}}-day free trial has come to an end. Please subscribe to a paid plan to continue using this service.", { trialDays: getBillingTrialDays() })}
        </Alert>
      )}
    </>
  );
}
