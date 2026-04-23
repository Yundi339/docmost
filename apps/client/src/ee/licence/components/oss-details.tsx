import { Group, List, Stack, Table, Text, ThemeIcon } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const enterpriseFeatureKeys = [
  "AI Integration (Chat, Search & Assistant)",
  "MCP Support",
  "SSO (SAML, OIDC, LDAP)",
  "Multi-factor Authentication (2FA)",
  "Page-level Permissions",
  "Page verification & approval workflow",
  "Audit Logs",
  "Enterprise Controls",
  "API Keys",
  "Advanced Search Engine Support",
  "Full-text Search in Attachments (PDF, DOCX)",
  "Resolve Comments",
  "Confluence Import",
  "DOCX Import",
];

export default function OssDetails() {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
      <Table.ScrollContainer minWidth={500} py="md">
        <Table
          variant="vertical"
          verticalSpacing="sm"
          layout="fixed"
          withTableBorder
        >
          <Table.Tbody>
            <Table.Tr>
              <Table.Th w={160}>{t("Edition")}</Table.Th>
              <Table.Td>
                <Group wrap="nowrap">
                  {t("Open Source")}
                  <div>
                    <ThemeIcon
                      color="green"
                      variant="light"
                      size={24}
                      radius="xl"
                    >
                      <IconCheck size={16} />
                    </ThemeIcon>
                  </div>
                </Group>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Stack gap="md">
        <Text fw={500}>{t("Upgrade to the Enterprise Edition to unlock:")}</Text>

        <List
          spacing={4}
          size="sm"
          icon={
            <ThemeIcon size={20} color={"gray"} radius="xl">
              <IconCheck size={14} />
            </ThemeIcon>
          }
        >
          {enterpriseFeatureKeys.map((feature) => (
            <List.Item key={feature}>{t(feature)}</List.Item>
          ))}
        </List>

        <Text size="sm" c="dimmed">
          {t("Contact your administrator to enable enterprise features.")}
        </Text>
      </Stack>
    </Stack>
  );
}
