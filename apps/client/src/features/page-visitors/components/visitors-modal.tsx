import { Modal, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { visitorsModalAtom } from "@/features/page-visitors/atoms/visitors-atoms";
import VisitorList from "@/features/page-visitors/components/visitor-list";
import useUserRole from "@/hooks/use-user-role";

interface Props {
  pageId: string;
}

// Owner-only "Visitor records" panel mounted as a sibling to FullEditor.
// We render nothing for non-owners so the network call is never even triggered.
export default function VisitorsModal({ pageId }: Props) {
  const { t } = useTranslation();
  const { isOwner } = useUserRole();
  const [opened, setOpened] = useAtom(visitorsModalAtom);

  if (!isOwner) return null;

  return (
    <Modal.Root
      size={720}
      opened={opened}
      onClose={() => setOpened(false)}
      centered
    >
      <Modal.Overlay />
      <Modal.Content style={{ overflow: "hidden" }}>
        <Modal.Header>
          <Modal.Title>
            <Text size="md" fw={500}>
              {t("Visitor records")}
            </Text>
          </Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body p={0}>
          {opened && <VisitorList pageId={pageId} />}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
