import {
  type Editor,
  NodeViewProps,
  NodeViewWrapper,
  useEditorState,
} from "@tiptap/react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  Popover,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconAdjustmentsHorizontal,
  IconAlignLeft,
  IconArrowBarToLeft,
  IconArrowBarToRight,
  IconArrowsMaximize,
  IconArrowsSort,
  IconAt,
  IconAutomation,
  IconCalculator,
  IconCalendar,
  IconChartBar,
  IconCheck,
  IconCheckbox,
  IconChevronRight,
  IconCircleDot,
  IconCopy,
  IconDatabase,
  IconDatabaseCog,
  IconDots,
  IconLayoutDashboard,
  IconEyeOff,
  IconFileText,
  IconFilter,
  IconFreezeColumn,
  IconFunction,
  IconHandClick,
  IconHash,
  IconGripVertical,
  IconId,
  IconLayoutList,
  IconLayoutBoard,
  IconLayoutGrid,
  IconLink,
  IconListDetails,
  IconMap,
  IconLock,
  IconMapPin,
  IconMoodSmile,
  IconPalette,
  IconPaperclip,
  IconPhone,
  IconPlus,
  IconRelationOneToOne,
  IconRss,
  IconSearch,
  IconSettings,
  IconSortAscending,
  IconSortDescending,
  IconSparkles,
  IconSubtask,
  IconTable,
  IconTimeline,
  IconTrash,
  IconUsers,
  IconX,
  IconForms,
} from "@tabler/icons-react";
import clsx from "clsx";
import {
  ComponentType,
  DragEvent as ReactDragEvent,
  Fragment,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import {
  useCreateDatabaseFieldMutation,
  useCreateDatabaseRecordMutation,
  useCreateDatabaseViewMutation,
  useAttachDatabasePageMutation,
  useAttachDatabasePageToDatabaseMutation,
  useDatabaseBoardTargetsQuery,
  useDeleteDatabaseMutation,
  useDatabaseInfoQuery,
  useDatabaseRecordsQuery,
  useReorderDatabaseRecordMutation,
  useTrashDatabaseRecordPageMutation,
  useUpdateDatabaseFieldMutation,
  useUpdateDatabaseFieldOptionMutation,
  useUpdateDatabaseRecordMutation,
  useUpdateDatabaseTitleMutation,
} from "@/features/database/queries/database-query";
import {
  DATABASE_BLOCK_DELETE_REQUEST_EVENT,
  DatabaseBlockDeleteRequest,
  confirmDatabaseBlockDeletion,
  getDatabaseBlockRanges,
  isDatabaseBlockOwnerContext,
} from "@/features/database/extensions/database-block-delete-guard";
import {
  DatabaseBlockInfo,
  DatabaseBoardTarget,
  DatabaseFieldDefinition,
  DatabaseRecord,
  DatabaseUser,
  DatabaseViewDefinition,
  DatabaseViewType,
} from "@/features/database/types/database.types";
import {
  getKanbanGroupField,
  projectRecordFieldsToBoard,
} from "@/features/database/utils/database-board-fields";
import { buildPageUrl } from "@/features/page/page.utils";
import { PageActionMenu } from "@/features/page/components/header/page-header-menu";
import {
  usePageQuery,
  useRestorePageMutation,
} from "@/features/page/queries/page-query";
import { useSearchSuggestionsQuery } from "@/features/search/queries/search-query";
import { PageShareModal } from "@/ee/page-permission";
import { notifications } from "@mantine/notifications";
import { isAxiosError } from "axios";
import { EmbeddedRecordPageEditor } from "./embedded-record-page-editor";
import {
  clearDocmostDragPayloads,
  DocmostPageDragPayload,
  hasDocmostPageLikeDrag,
  parseDocmostDatabaseRecordDragPayload,
  parseDocmostPageDragPayload,
  setDocmostDatabaseRecordDragData,
  setDocmostPageDragData,
} from "@/features/database/utils/database-drag";
import classes from "./database-block-view.module.css";

const DEFAULT_STATUSES = ["Todo", "In progress", "Done"];
const DEFAULT_DATABASE_TITLE = "New database";
const TITLE_FIELD = "Title";

function isExternalDatabase(database?: DatabaseBlockInfo) {
  const datasheetId = database?.apitableDatasheetId;
  const provider = database?.metadata?.provider;
  return Boolean(
    datasheetId &&
    provider !== "docmost-native" &&
    provider !== "docmost-local" &&
    !datasheetId.startsWith("native_") &&
    !datasheetId.startsWith("local_"),
  );
}

const FIELD_LABELS: Record<string, string> = {
  Title: "Name",
  Status: "Status",
  Assignee: "Assignee",
  "Due date": "Due date",
  Priority: "Priority",
  Tags: "Tags",
  Description: "Description",
};

const FIELD_TYPE_LABELS: Record<DatabaseFieldDefinition["type"], string> = {
  text: "Text",
  longText: "Text",
  number: "Number",
  select: "Select",
  singleSelect: "Select",
  multiSelect: "Multi-select",
  status: "Status",
  date: "Date",
  user: "Person",
  person: "Person",
  attachment: "Files & media",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone: "Phone",
  relation: "Relation",
  rollup: "Rollup",
  formula: "Formula",
  button: "Button",
  id: "ID",
  place: "Place",
};

type FieldTypeOption = {
  type: DatabaseFieldDefinition["type"];
  label: string;
  icon: ComponentType<{
    size?: string | number;
    stroke?: string | number;
    className?: string;
  }>;
  disabled?: boolean;
};

const PROPERTY_TYPES: FieldTypeOption[] = [
  { type: "text", label: "Text", icon: IconAlignLeft },
  { type: "number", label: "Number", icon: IconHash },
  { type: "singleSelect", label: "Select", icon: IconCircleDot },
  { type: "multiSelect", label: "Multi-select", icon: IconListDetails },
  { type: "status", label: "Status", icon: IconSparkles },
  { type: "date", label: "Date", icon: IconCalendar },
  { type: "user", label: "Person", icon: IconUsers },
  { type: "checkbox", label: "Checkbox", icon: IconCheckbox },
  { type: "url", label: "URL", icon: IconLink },
  { type: "phone", label: "Phone", icon: IconPhone },
  { type: "email", label: "Email", icon: IconAt },
  {
    type: "relation",
    label: "Relation",
    icon: IconRelationOneToOne,
    disabled: true,
  },
  { type: "rollup", label: "Rollup", icon: IconSearch, disabled: true },
  { type: "formula", label: "Formula", icon: IconFunction, disabled: true },
  { type: "button", label: "Button", icon: IconHandClick, disabled: true },
  { type: "id", label: "ID", icon: IconId },
  { type: "place", label: "Place", icon: IconMapPin, disabled: true },
];

type PeopleOption = {
  value: string;
  label: string;
  email?: string | null;
  avatarUrl?: string | null;
};

type CreateFieldInput = {
  name?: string;
  type: DatabaseFieldDefinition["type"];
  options?: string[];
  position?: "left" | "right" | "end";
  anchorFieldName?: string;
};

type UpdateFieldInput = {
  fieldName: string;
  name?: string;
  type?: DatabaseFieldDefinition["type"];
  options?: string[];
};

function valueAsString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function valueAsStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(valueAsString).filter(Boolean);
  const stringValue = valueAsString(value);
  return stringValue ? [stringValue] : [];
}

function fieldLabel(fieldName: string, t: (key: string) => string) {
  return t(FIELD_LABELS[fieldName] ?? fieldName);
}

function fieldTypeLabel(
  type: DatabaseFieldDefinition["type"],
  t: (key: string) => string,
) {
  return t(FIELD_TYPE_LABELS[type] ?? "Text");
}

function translatedValue(value: unknown, t: (key: string) => string): string {
  const stringValue = valueAsString(value);
  return stringValue ? t(stringValue) : "";
}

function supportsOptions(type: DatabaseFieldDefinition["type"]) {
  return ["select", "singleSelect", "multiSelect", "status"].includes(type);
}

function defaultOptionsForType(
  type: DatabaseFieldDefinition["type"],
): string[] | undefined {
  if (type === "status") return DEFAULT_STATUSES;
  if (type === "select" || type === "singleSelect" || type === "multiSelect")
    return ["Option"];
  return undefined;
}

function normalizeOptions(options: string[]) {
  return Array.from(
    new Set(options.map((option) => option.trim()).filter(Boolean)),
  );
}

function uniqueOptionName(rawName: string, options: string[]) {
  const baseName = rawName.trim() || "New group";
  const existing = new Set(options);
  if (!existing.has(baseName)) return baseName;

  let suffix = 2;
  while (existing.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}

function datePickerValue(value: unknown): string | null {
  const stringValue = valueAsString(value);
  return stringValue || null;
}

function datePickerToStorage(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function optionTone(option: string, index = 0) {
  const normalized = option.toLowerCase();
  if (
    ["todo", "not started", "not start", "未开始", "待办"].some((item) =>
      normalized.includes(item),
    )
  ) {
    return "gray";
  }
  if (
    ["progress", "doing", "进行中"].some((item) => normalized.includes(item))
  ) {
    return "blue";
  }
  if (
    ["done", "complete", "completed", "已完成", "完成"].some((item) =>
      normalized.includes(item),
    )
  ) {
    return "green";
  }
  if (
    ["block", "blocked", "阻塞", "high", "高"].some((item) =>
      normalized.includes(item),
    )
  ) {
    return "red";
  }
  if (["medium", "中"].some((item) => normalized.includes(item))) {
    return "yellow";
  }
  if (["low", "低"].some((item) => normalized.includes(item))) {
    return "gray";
  }
  return ["gray", "blue", "green", "yellow", "purple", "pink"][index % 6];
}

function viewLabel(view: DatabaseViewDefinition, t: (key: string) => string) {
  if (view.type === "kanban") return t(view.name || "Board");
  if (view.type === "table") return t(view.name || "Table");
  if (view.type === "calendar") return t(view.name || "Calendar");
  if (view.type === "gallery") return t(view.name || "Gallery");
  if (view.type === "list") return t(view.name || "List");
  if (view.type === "timeline") return t(view.name || "Timeline");
  if (view.type === "chart") return t(view.name || "Chart");
  if (view.type === "dashboard") return t(view.name || "Dashboard");
  if (view.type === "feed") return t(view.name || "Feed");
  if (view.type === "map") return t(view.name || "Map");
  if (view.type === "form") return t(view.name || "Form");
  return t(view.name);
}

function ViewIcon({ type }: { type: DatabaseViewType }) {
  if (type === "kanban") return <IconLayoutBoard size={15} />;
  if (type === "calendar") return <IconCalendar size={15} />;
  if (type === "gallery") return <IconLayoutGrid size={15} />;
  if (type === "list") return <IconLayoutList size={15} />;
  if (type === "timeline") return <IconTimeline size={15} />;
  if (type === "chart") return <IconChartBar size={15} />;
  if (type === "dashboard") return <IconLayoutDashboard size={15} />;
  if (type === "feed") return <IconRss size={15} />;
  if (type === "map") return <IconMap size={15} />;
  if (type === "form") return <IconForms size={15} />;
  return <IconTable size={15} />;
}

function viewNameForType(type: DatabaseViewType) {
  if (type === "kanban") return "Board";
  if (type === "calendar") return "Calendar";
  if (type === "gallery") return "Gallery";
  if (type === "list") return "List";
  if (type === "timeline") return "Timeline";
  if (type === "chart") return "Chart";
  if (type === "dashboard") return "Dashboard";
  if (type === "feed") return "Feed";
  if (type === "map") return "Map";
  if (type === "form") return "Form";
  return "Table";
}

const VIEW_TYPES: Array<{
  type: DatabaseViewType;
  description: string;
  groupBy?: string;
}> = [
  { type: "table", description: "Rows and properties" },
  { type: "kanban", description: "Cards grouped by status", groupBy: "Status" },
  {
    type: "timeline",
    description: "Pages arranged by date",
    groupBy: "Due date",
  },
  { type: "calendar", description: "Pages on a calendar", groupBy: "Due date" },
  { type: "list", description: "Compact page list" },
  { type: "gallery", description: "Visual page cards" },
  { type: "chart", description: "Summaries and charts" },
  { type: "dashboard", description: "Metrics overview" },
  { type: "feed", description: "Activity-like feed" },
  { type: "map", description: "Location-based records" },
  { type: "form", description: "Collect new pages" },
];

function AddViewMenu({
  existingViews,
  fields,
  onCreateView,
}: {
  existingViews: DatabaseViewDefinition[];
  fields: DatabaseFieldDefinition[];
  onCreateView: (view: {
    name: string;
    type: DatabaseViewType;
    groupBy?: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [selectedType, setSelectedType] = useState<DatabaseViewType>("table");
  const existingTypeCount = (type: DatabaseViewType) =>
    existingViews.filter((view) => view.type === type).length;
  const selectedView =
    VIEW_TYPES.find((view) => view.type === selectedType) ?? VIEW_TYPES[0];
  const selectedGroupBy = (() => {
    if (selectedType === "kanban") {
      return getKanbanGroupField(fields)?.name;
    }
    if (["calendar", "timeline"].includes(selectedType)) {
      return (
        fields.find((field) => field.name === selectedView.groupBy)?.name ??
        fields.find((field) => field.type === "date")?.name
      );
    }
    return undefined;
  })();
  const selectedName = (() => {
    const count = existingTypeCount(selectedType);
    return count > 0
      ? `${viewNameForType(selectedType)} ${count + 1}`
      : viewNameForType(selectedType);
  })();

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={520}
      shadow="md"
      position="bottom-start"
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.addViewButton}
          onClick={() => setOpened((value) => !value)}
        >
          <IconPlus size={15} />
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className={classes.addViewPopover}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={classes.addViewHeader}>
          <Text fw={650}>{t("Add a new view")}</Text>
          <Text size="xs" c="dimmed">
            {t("Choose how this database should appear.")}
          </Text>
        </div>
        <div className={classes.addViewGrid}>
          {VIEW_TYPES.map((view) => (
            <button
              key={view.type}
              type="button"
              className={clsx(
                classes.addViewTile,
                selectedType === view.type && classes.addViewTileActive,
              )}
              onClick={() => setSelectedType(view.type)}
            >
              <ViewIcon type={view.type} />
              <span>{t(viewNameForType(view.type))}</span>
              <em>{t(view.description)}</em>
            </button>
          ))}
        </div>
        <div className={classes.addDataSourceRow}>
          <IconDatabase size={16} />
          <span>{t("Uses current database source")}</span>
        </div>
        <div className={classes.addViewFooter}>
          <div className={classes.addViewSelected}>
            <ViewIcon type={selectedType} />
            <span>{t(selectedName)}</span>
          </div>
          <Button
            size="xs"
            className={classes.newButton}
            onClick={() => {
              onCreateView({
                name: selectedName,
                type: selectedType,
                groupBy: selectedGroupBy,
              });
              setOpened(false);
            }}
          >
            {t("Add view")}
          </Button>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

function FieldPickerPopover({
  icon,
  label,
  placeholder,
  fields,
  active,
  footer,
  onFooterClick,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  placeholder: string;
  fields: DatabaseFieldDefinition[];
  active?: boolean;
  footer?: string;
  onFooterClick?: () => void;
  onSelect: (field: DatabaseFieldDefinition) => void;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState("");
  const visibleFields = fields.filter((field) => {
    const labelText = fieldLabel(field.name, t).toLowerCase();
    return labelText.includes(query.trim().toLowerCase());
  });

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={280}
      shadow="md"
      position="bottom-end"
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className={clsx(
            classes.toolbarButton,
            active && classes.toolbarButtonActive,
          )}
          onClick={() => setOpened((value) => !value)}
        >
          {icon}
          <span>{t(label)}</span>
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className={classes.notionPopover}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className={classes.popoverSearch}>
          <IconSearch size={15} />
          <input
            value={query}
            placeholder={t(placeholder)}
            onChange={(event) => setQuery(event.currentTarget.value)}
            autoFocus
          />
        </label>
        <div className={classes.popoverList}>
          {visibleFields.map((field) => {
            const Icon = fieldTypeIcon(field.type);
            return (
              <button
                key={field.name}
                type="button"
                className={classes.popoverListItem}
                onClick={() => {
                  onSelect(field);
                  setOpened(false);
                }}
              >
                <Icon size={16} />
                <span>{fieldLabel(field.name, t)}</span>
              </button>
            );
          })}
          {visibleFields.length === 0 && (
            <div className={classes.popoverEmpty}>{t("No options")}</div>
          )}
        </div>
        {footer && (
          <button
            type="button"
            className={classes.popoverFooter}
            onClick={() => {
              onFooterClick?.();
              setOpened(false);
            }}
          >
            <IconPlus size={15} />
            {t(footer)}
          </button>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

function ViewSettingsPopover({
  activeView,
  fields,
  sourceTitle,
  filterField,
  filterText,
  sortField,
  sortDirection,
  onFilterFieldChange,
  onFilterTextChange,
  onClearFilter,
  onSortFieldChange,
  onClearSort,
}: {
  activeView: DatabaseViewDefinition;
  fields: DatabaseFieldDefinition[];
  sourceTitle: string;
  filterField: string | null;
  filterText: string;
  sortField: string | null;
  sortDirection: "asc" | "desc";
  onFilterFieldChange: (fieldName: string | null) => void;
  onFilterTextChange: (value: string) => void;
  onClearFilter: () => void;
  onSortFieldChange: (fieldName: string) => void;
  onClearSort: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Popover width={360} shadow="md" position="bottom-end" withinPortal>
      <Popover.Target>
        <ActionIcon variant="subtle" aria-label={t("View settings")}>
          <IconAdjustmentsHorizontal size={17} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown
        className={classes.viewSettingsPopover}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={classes.viewSettingsHeader}>
          <ViewIcon type={activeView.type} />
          <div>
            <Text size="sm" fw={650}>
              {viewLabel(activeView, t)}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {sourceTitle}
            </Text>
          </div>
        </div>

        <div className={classes.settingsSection}>
          <div className={classes.settingsSectionTitle}>
            <IconFilter size={15} />
            <span>{t("Filter")}</span>
          </div>
          <select
            value={filterField ?? ""}
            onChange={(event) =>
              onFilterFieldChange(event.currentTarget.value || null)
            }
          >
            <option value="">{t("All properties")}</option>
            {fields.map((field) => (
              <option key={field.name} value={field.name}>
                {fieldLabel(field.name, t)}
              </option>
            ))}
          </select>
          <input
            value={filterText}
            placeholder={t("Filter value...")}
            onChange={(event) => onFilterTextChange(event.currentTarget.value)}
          />
          {(filterField || filterText) && (
            <button
              type="button"
              className={classes.settingsInlineButton}
              onClick={onClearFilter}
            >
              <IconX size={14} />
              {t("Clear")}
            </button>
          )}
        </div>

        <div className={classes.settingsSection}>
          <div className={classes.settingsSectionTitle}>
            <IconArrowsSort size={15} />
            <span>{t("Sort")}</span>
          </div>
          <div className={classes.viewSettingsList}>
            {fields.map((field) => {
              const Icon = fieldTypeIcon(field.type);
              const active = sortField === field.name;
              return (
                <button
                  key={field.name}
                  type="button"
                  className={clsx(
                    classes.viewSettingsItem,
                    active && classes.viewSettingsItemActive,
                  )}
                  onClick={() => onSortFieldChange(field.name)}
                >
                  <Icon size={16} />
                  <span>{fieldLabel(field.name, t)}</span>
                  {active && (
                    <em>
                      {sortDirection === "asc"
                        ? t("Ascending")
                        : t("Descending")}
                    </em>
                  )}
                </button>
              );
            })}
            {sortField && (
              <button
                type="button"
                className={classes.viewSettingsItem}
                onClick={onClearSort}
              >
                <IconX size={16} />
                <span>{t("Clear sort")}</span>
              </button>
            )}
          </div>
        </div>

        <div className={classes.settingsSection}>
          <div className={classes.settingsSectionTitle}>
            <IconDatabaseCog size={15} />
            <span>{t("Source")}</span>
          </div>
          <div className={classes.sourceCard}>
            <IconDatabase size={16} />
            <span>{sourceTitle || t("Current database")}</span>
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

function fieldTypeIcon(type: DatabaseFieldDefinition["type"]) {
  if (type === "number") return IconHash;
  if (type === "singleSelect" || type === "select") return IconCircleDot;
  if (type === "multiSelect") return IconListDetails;
  if (type === "status") return IconSparkles;
  if (type === "date") return IconCalendar;
  if (type === "user" || type === "person") return IconUsers;
  if (type === "attachment") return IconPaperclip;
  if (type === "checkbox") return IconCheckbox;
  if (type === "url") return IconLink;
  if (type === "email") return IconAt;
  if (type === "phone") return IconPhone;
  if (type === "relation") return IconRelationOneToOne;
  if (type === "rollup") return IconSearch;
  if (type === "formula") return IconFunction;
  if (type === "button") return IconHandClick;
  if (type === "id") return IconId;
  if (type === "place") return IconMapPin;
  return IconAlignLeft;
}

function isSelectField(field: DatabaseFieldDefinition) {
  return (
    ["singleSelect", "select", "status"].includes(field.type) ||
    field.name === "Status" ||
    field.name === "Priority"
  );
}

type DragPagePayload = DocmostPageDragPayload;

function pagePayloadFromDrag(
  dataTransfer: DataTransfer,
): DragPagePayload | null {
  return parseDocmostPageDragPayload(dataTransfer);
}

function setRecordDragData(
  dataTransfer: DataTransfer,
  record: DatabaseRecord,
  sourceDatabaseId?: string,
) {
  setDocmostDatabaseRecordDragData(dataTransfer, {
    recordId: record.id,
    sourceDatabaseId,
  });
  if (record.pageId && record.pageSlugId) {
    setDocmostPageDragData(dataTransfer, {
      pageId: record.pageId,
      slugId: record.pageSlugId,
      title: record.pageTitle || record.title,
      icon: record.pageIcon,
      sourceDatabaseId,
      sourceRecordId: record.id,
    });
  }
}

function getDraggedRecordId(dataTransfer: DataTransfer) {
  return parseDocmostDatabaseRecordDragPayload(dataTransfer)?.recordId ?? "";
}

function getDraggedRecordSourceDatabaseId(dataTransfer: DataTransfer) {
  return parseDocmostDatabaseRecordDragPayload(dataTransfer)?.sourceDatabaseId;
}

function hasDocmostDatabaseDrag(dataTransfer: DataTransfer) {
  return hasDocmostPageLikeDrag(dataTransfer);
}

function isSameDatabaseDrag(
  payload: DragPagePayload | null,
  databaseId?: string,
  dataTransfer?: DataTransfer,
) {
  const sourceDatabaseId =
    payload?.sourceDatabaseId ||
    (dataTransfer ? getDraggedRecordSourceDatabaseId(dataTransfer) : undefined);
  return Boolean(sourceDatabaseId && sourceDatabaseId === databaseId);
}

function isRecordEditable(canEdit: boolean, record: DatabaseRecord) {
  return canEdit && record.canEdit !== false;
}

function shouldSkipRecordDrag(target: EventTarget | null) {
  return Boolean(
    target instanceof HTMLElement &&
    target.closest(
      "button, a, input, textarea, select, [contenteditable='true'], [data-no-row-drag]",
    ),
  );
}

export default function DatabaseBlockView(props: NodeViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { spaceSlug } = useParams();
  const { node, selected, editor, updateAttributes, getPos } = props;
  const databaseId = node.attrs.databaseId as string | undefined;
  const blockId = node.attrs.blockId as string | undefined;
  const duplicateOwnerReferenceCount = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) =>
      currentEditor && databaseId && blockId
        ? getDatabaseBlockRanges(currentEditor.state.doc, databaseId, blockId)
            .length
        : 0,
  });
  const fallbackTitle =
    (node.attrs.title as string | undefined) || DEFAULT_DATABASE_TITLE;
  const fallbackViewType =
    (node.attrs.viewType as DatabaseViewType | undefined) || "table";
  const hostPageId = (editor.storage as { pageId?: string }).pageId;
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [openedRecord, setOpenedRecord] = useState<DatabaseRecord | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [filterField, setFilterField] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [userSearch, setUserSearch] = useState("");
  const [titleDraft, setTitleDraft] = useState(fallbackTitle);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [boardMoveRecord, setBoardMoveRecord] = useState<DatabaseRecord | null>(
    null,
  );
  const [kanbanDraftStatus, setKanbanDraftStatus] = useState<string | null>(
    null,
  );
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const databaseQuery = useDatabaseInfoQuery(databaseId);
  const recordsQuery = useDatabaseRecordsQuery(databaseId);
  const deleteDatabaseMutation = useDeleteDatabaseMutation(databaseId);
  const boardTargetsQuery = useDatabaseBoardTargetsQuery(databaseId);
  const createRecordMutation = useCreateDatabaseRecordMutation(databaseId);
  const updateRecordMutation = useUpdateDatabaseRecordMutation(databaseId);
  const updateTitleMutation = useUpdateDatabaseTitleMutation(databaseId);
  const createFieldMutation = useCreateDatabaseFieldMutation(databaseId);
  const updateFieldMutation = useUpdateDatabaseFieldMutation(databaseId);
  const updateFieldOptionMutation =
    useUpdateDatabaseFieldOptionMutation(databaseId);
  const createViewMutation = useCreateDatabaseViewMutation(databaseId);
  const reorderRecordMutation = useReorderDatabaseRecordMutation(databaseId);
  const attachPageMutation = useAttachDatabasePageMutation(databaseId);
  const attachPageToDatabaseMutation =
    useAttachDatabasePageToDatabaseMutation();
  const trashRecordPageMutation =
    useTrashDatabaseRecordPageMutation(databaseId);
  const restorePageMutation = useRestorePageMutation();

  const database = databaseQuery.data;
  const hasVerifiedOwnership = isDatabaseBlockOwnerContext(
    database,
    hostPageId,
    blockId,
  );
  const hasOwnershipMismatch =
    !blockId ||
    Boolean(
      database &&
      hostPageId &&
      !isDatabaseBlockOwnerContext(database, hostPageId, blockId),
    );
  const hasDuplicateOwnerReference = Boolean(
    databaseId && blockId && duplicateOwnerReferenceCount > 1,
  );
  const removesOnlyCurrentBlock =
    hasOwnershipMismatch || hasDuplicateOwnerReference;
  const deleteActionLabel = removesOnlyCurrentBlock
    ? "Remove board block"
    : "Delete board";
  const canEditDatabase = editor.isEditable && hasVerifiedOwnership;
  const externalDatabase = isExternalDatabase(database);
  const canEditSchema = canEditDatabase && !externalDatabase;
  const records = recordsQuery.data ?? [];
  const views = database?.views?.length
    ? database.views
    : [
        {
          id: fallbackViewType,
          name: fallbackViewType,
          type: fallbackViewType,
        },
      ];
  const activeView =
    views.find(
      (view) => view.id === (activeViewId || database?.activeViewId),
    ) || views[0];
  const fields = database?.fields?.length
    ? database.fields
    : [{ name: TITLE_FIELD, type: "text" as const }];
  const hasPersonField = fields.some(
    (field) =>
      field.name === "Assignee" ||
      field.type === "user" ||
      field.type === "person",
  );
  const [debouncedUserSearch] = useDebouncedValue(userSearch, 300);
  const userSuggestionsQuery = useSearchSuggestionsQuery({
    query: debouncedUserSearch,
    includeUsers: true,
    context: "database-person",
    pageId: hostPageId,
    limit: 50,
    preload: true,
    enabled: Boolean(
      hostPageId &&
      database &&
      canEditDatabase &&
      hasPersonField &&
      !deleteDatabaseMutation.isPending,
    ),
  });
  const statusField = getKanbanGroupField(fields, activeView);
  const statusFieldName = statusField?.name ?? "Status";
  const statuses = statusField?.options?.length
    ? statusField.options
    : DEFAULT_STATUSES;
  const recordsWithViewStatus = useMemo(
    () =>
      records.map((record) => {
        const value = record.fields[statusFieldName];
        return typeof value === "string" && value
          ? { ...record, status: value }
          : record;
      }),
    [records, statusFieldName],
  );
  const hasQueryError = databaseQuery.isError || recordsQuery.isError;
  const isInitialLoading = databaseQuery.isLoading || recordsQuery.isLoading;
  const manualReorderDisabled = Boolean(sortField || filterText.trim());

  const users = useMemo(
    () =>
      ((userSuggestionsQuery.data?.users ?? []) as DatabaseUser[]).filter(
        (user) => Boolean(user?.id),
      ),
    [userSuggestionsQuery.data],
  );

  const userById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );

  const userOptions: PeopleOption[] = users.map((user) => ({
    value: user.id,
    label: user.name || user.id,
    email: user.email,
    avatarUrl: user.avatarUrl,
  }));

  const displayedRecords = useMemo(() => {
    const normalizedFilter = filterText.trim().toLowerCase();
    const filteredRecords = normalizedFilter
      ? recordsWithViewStatus.filter((record) => {
          const searchableValues = filterField
            ? [
                filterField === TITLE_FIELD
                  ? record.title
                  : record.fields[filterField],
              ]
            : [record.title, ...Object.values(record.fields)];

          return searchableValues.some((value) =>
            renderCell(value).toLowerCase().includes(normalizedFilter),
          );
        })
      : recordsWithViewStatus;

    if (!sortField) return filteredRecords;

    return [...filteredRecords].sort((left, right) => {
      const leftValue = renderCell(
        sortField === TITLE_FIELD ? left.title : left.fields[sortField],
      ).toLowerCase();
      const rightValue = renderCell(
        sortField === TITLE_FIELD ? right.title : right.fields[sortField],
      ).toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });
  }, [
    filterField,
    filterText,
    recordsWithViewStatus,
    sortDirection,
    sortField,
  ]);

  useEffect(() => {
    setTitleDraft(database?.title || fallbackTitle || DEFAULT_DATABASE_TITLE);
  }, [database?.title, fallbackTitle]);

  useEffect(() => {
    const handleDeleteRequest = (event: Event) => {
      const request = (event as CustomEvent<DatabaseBlockDeleteRequest>).detail;
      let currentPosition: number | undefined;
      try {
        const position = getPos();
        currentPosition = typeof position === "number" ? position : undefined;
      } catch {
        return;
      }
      if (
        request?.databaseId === databaseId &&
        (!request.blockId || request.blockId === blockId) &&
        (request.position === undefined ||
          request.position === currentPosition) &&
        editor.isEditable
      ) {
        setDeleteModalOpened(true);
      }
    };

    document.addEventListener(
      DATABASE_BLOCK_DELETE_REQUEST_EVENT,
      handleDeleteRequest,
    );
    return () => {
      document.removeEventListener(
        DATABASE_BLOCK_DELETE_REQUEST_EVENT,
        handleDeleteRequest,
      );
    };
  }, [blockId, databaseId, editor.isEditable, getPos]);

  useEffect(() => {
    if (!openedRecord) return;

    const latestRecord = records.find(
      (record) => record.id === openedRecord.id,
    );
    if (latestRecord) setOpenedRecord(latestRecord);
  }, [openedRecord?.id, records]);

  const createRecordWithFields = async (
    fields: Record<string, unknown> = {},
  ): Promise<boolean> => {
    if (!canEditDatabase) return false;
    try {
      await createRecordMutation.mutateAsync({
        [TITLE_FIELD]: "",
        ...fields,
      });
      return true;
    } catch {
      notifications.show({
        message: t("Failed to create record"),
        color: "red",
      });
      return false;
    }
  };

  const createRecord = (status?: string, title?: string) => {
    const nextTitle = title?.trim();
    return createRecordWithFields({
      [statusFieldName]: status || statuses[0] || "Todo",
      ...(nextTitle ? { Title: nextTitle } : {}),
    });
  };

  const updateRecord = (recordId: string, fields: Record<string, unknown>) => {
    if (!canEditDatabase) return;
    updateRecordMutation.mutate({ recordId, fields });
  };

  const openFullPage = (record: DatabaseRecord | null) => {
    if (!record?.pageSlugId) return;
    navigate(
      buildPageUrl(
        spaceSlug,
        record.pageSlugId,
        record.pageTitle || record.title,
      ),
    );
  };

  const notifyManualReorderDisabled = () => {
    notifications.show({
      message: t("Clear sort and filter to reorder records manually"),
      color: "yellow",
    });
  };

  const showUndoNotification = (
    message: string,
    onUndo: () => void | Promise<void>,
  ) => {
    notifications.show({
      message: (
        <Group gap="xs" wrap="nowrap">
          <Text size="sm">{message}</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => void onUndo()}
          >
            {t("Undo")}
          </Button>
        </Group>
      ),
    });
  };

  const reattachRecordToCurrentBoard = async (
    record: DatabaseRecord,
    source?: { databaseId: string; recordId: string },
  ) => {
    if (!canEditDatabase || !databaseId || !record.pageId) return;

    await attachPageToDatabaseMutation.mutateAsync({
      databaseId,
      pageId: record.pageId,
      fields: {
        [statusFieldName]: statuses.includes(record.status)
          ? record.status
          : statuses[0],
      },
      sourceDatabaseId: source?.databaseId,
      sourceRecordId: source?.recordId,
    });
  };

  const reorderRecord = (recordId: string, beforeRecordId?: string) => {
    if (!canEditDatabase) return;
    if (manualReorderDisabled) {
      notifyManualReorderDisabled();
      return;
    }

    const visibleRecords = displayedRecords.filter(
      (record) => record.id !== recordId,
    );
    const beforeIndex = beforeRecordId
      ? visibleRecords.findIndex((record) => record.id === beforeRecordId)
      : visibleRecords.length;
    const afterRecord =
      visibleRecords[
        (beforeIndex < 0 ? visibleRecords.length : beforeIndex) - 1
      ];

    reorderRecordMutation.mutate({
      recordId,
      beforeRecordId,
      afterRecordId: afterRecord?.id,
    });
  };

  const attachPageFromPayload = (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => {
    if (!payload?.pageId || !canEditDatabase) return;
    if (payload.sourceDatabaseId === databaseId) return;

    attachPageMutation.mutate({
      pageId: payload.pageId,
      fields: {
        ...(!payload.sourceDatabaseId && payload.title
          ? { Title: payload.title }
          : {}),
        ...fields,
      },
      sourceDatabaseId: payload.sourceDatabaseId,
      sourceRecordId: payload.sourceRecordId,
    });
  };

  const moveRecordToBoard = async (target: DatabaseBoardTarget) => {
    const record = boardMoveRecord;
    if (!canEditDatabase || !databaseId || !record?.pageId) return;

    try {
      const targetRecord = await attachPageToDatabaseMutation.mutateAsync({
        databaseId: target.id,
        pageId: record.pageId,
        fields: projectRecordFieldsToBoard(record, target),
        sourceDatabaseId: databaseId,
        sourceRecordId: record.id,
      });

      if (openedRecord?.id === record.id) setOpenedRecord(null);
      setBoardMoveRecord(null);
      showUndoNotification(t("Moved to another board"), async () => {
        try {
          await reattachRecordToCurrentBoard(record, {
            databaseId: target.id,
            recordId: targetRecord.id,
          });
          notifications.show({ message: t("Restored to board") });
        } catch {
          notifications.show({
            message: t("Failed to restore to board"),
            color: "red",
          });
        }
      });
    } catch {
      notifications.show({
        message: t("Failed to move to another board"),
        color: "red",
      });
    }
  };

  const moveRecordPageToTrash = (record: DatabaseRecord) => {
    if (!canEditDatabase || !record.pageId) return;

    trashRecordPageMutation.mutate(
      { recordId: record.id },
      {
        onSuccess: () => {
          if (openedRecord?.id === record.id) setOpenedRecord(null);
          showUndoNotification(t("Moved to trash"), async () => {
            try {
              await restorePageMutation.mutateAsync(record.pageId!);
              notifications.show({ message: t("Restored page") });
            } catch {
              notifications.show({
                message: t("Failed to restore page"),
                color: "red",
              });
            }
          });
        },
      },
    );
  };

  const commitTitle = () => {
    const nextTitle = titleDraft.trim();
    if (!canEditDatabase || !databaseId || nextTitle === database?.title)
      return;
    updateAttributes?.({ title: nextTitle || DEFAULT_DATABASE_TITLE });
    updateTitleMutation.mutate(nextTitle);
  };

  const removeDatabaseBlockNodes = () => {
    if (!databaseId) return false;
    const ranges = getDatabaseBlockRanges(editor.state.doc, databaseId);
    if (ranges.length === 0) return false;

    const transaction = editor.state.tr;
    for (const range of ranges.reverse()) {
      transaction.delete(range.from, range.to);
    }
    editor.view.dispatch(confirmDatabaseBlockDeletion(transaction));
    return true;
  };

  const removeCurrentDatabaseBlockNode = () => {
    let position: number | undefined;
    try {
      const currentPosition = getPos();
      position =
        typeof currentPosition === "number" ? currentPosition : undefined;
    } catch {
      return false;
    }
    if (position === undefined) return false;

    const transaction = editor.state.tr.delete(
      position,
      position + node.nodeSize,
    );
    editor.view.dispatch(confirmDatabaseBlockDeletion(transaction));
    return true;
  };

  const confirmDeleteDatabase = async () => {
    if (removesOnlyCurrentBlock) {
      setDeleteModalOpened(false);
      removeCurrentDatabaseBlockNode();
      notifications.show({ message: t("Board block removed") });
      return;
    }

    if (!hostPageId || !blockId) {
      notifications.show({
        message: t("Failed to delete board"),
        color: "red",
      });
      return;
    }

    try {
      await deleteDatabaseMutation.mutateAsync({
        pageId: hostPageId,
        blockId,
      });
      setDeleteModalOpened(false);
      removeDatabaseBlockNodes();
      notifications.show({ message: t("Board deleted") });
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        setDeleteModalOpened(false);
        removeCurrentDatabaseBlockNode();
        notifications.show({ message: t("Board block removed") });
        return;
      }
      notifications.show({
        message: t("Failed to delete board"),
        color: "red",
      });
    }
  };

  useEffect(() => {
    if (!databaseId || !canEditDatabase) return;

    const isInsideThisDatabase = (event: DragEvent) => {
      const root = rootRef.current;
      if (!root) return false;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-record-side-page]")) return false;
      if (target && root.contains(target)) return true;
      const rect = root.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };

    const handleDocumentDragOver = (event: DragEvent) => {
      if (!event.dataTransfer || !isInsideThisDatabase(event)) return;
      if (!hasDocmostDatabaseDrag(event.dataTransfer)) return;
      event.preventDefault();
    };

    const handleDocumentDrop = (event: DragEvent) => {
      if (!event.dataTransfer || !isInsideThisDatabase(event)) return;
      const recordId = getDraggedRecordId(event.dataTransfer);
      const pagePayload = parseDocmostPageDragPayload(event.dataTransfer);
      if (
        recordId &&
        isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
      )
        return;
      if (!pagePayload?.pageId) return;

      const target = event.target as HTMLElement | null;
      const kanbanStatus = target
        ?.closest?.("[data-database-kanban-status]")
        ?.getAttribute("data-database-kanban-status");

      event.preventDefault();
      event.stopPropagation();
      attachPageFromPayload(
        pagePayload,
        kanbanStatus ? { [statusFieldName]: kanbanStatus } : undefined,
      );
    };

    document.addEventListener("dragover", handleDocumentDragOver, true);
    document.addEventListener("drop", handleDocumentDrop, true);
    return () => {
      document.removeEventListener("dragover", handleDocumentDragOver, true);
      document.removeEventListener("drop", handleDocumentDrop, true);
    };
  }, [attachPageMutation, canEditDatabase, databaseId, statusFieldName]);

  if (!databaseId) {
    return (
      <NodeViewWrapper className={classes.databaseBlock} data-drag-handle>
        <div className={classes.empty}>
          <IconDatabase size={24} />
          <Text fw={600}>{t(fallbackTitle)}</Text>
          <Text size="sm" c="dimmed">
            {t("This database block is not connected yet.")}
          </Text>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      ref={rootRef}
      data-docmost-database-block="true"
      className={clsx(
        "node-databaseBlock",
        classes.databaseBlock,
        selected && classes.selected,
        isFullscreen && classes.databaseBlockFullscreen,
      )}
      onDragOverCapture={(event) => {
        if (
          (event.target as HTMLElement | null)?.closest?.(
            "[data-record-side-page]",
          )
        )
          return;
        if (!canEditDatabase || !hasDocmostDatabaseDrag(event.dataTransfer))
          return;
        event.preventDefault();
      }}
      onDropCapture={(event) => {
        if (
          (event.target as HTMLElement | null)?.closest?.(
            "[data-record-side-page]",
          )
        )
          return;
        if (!canEditDatabase || !hasDocmostDatabaseDrag(event.dataTransfer))
          return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-database-drop-zone]")) return;
        const recordId = getDraggedRecordId(event.dataTransfer);
        const pagePayload = pagePayloadFromDrag(event.dataTransfer);
        if (!recordId && !pagePayload) return;
        event.preventDefault();
        event.stopPropagation();
        if (
          recordId &&
          isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
        ) {
          reorderRecord(recordId);
          return;
        }
        if (pagePayload) attachPageFromPayload(pagePayload);
      }}
      onDrop={(event) => {
        if (
          (event.target as HTMLElement | null)?.closest?.(
            "[data-record-side-page]",
          )
        )
          return;
        const recordId = getDraggedRecordId(event.dataTransfer);
        const pagePayload = pagePayloadFromDrag(event.dataTransfer);
        if (recordId || pagePayload) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (
          recordId &&
          isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
        ) {
          reorderRecord(recordId);
          return;
        }
        if (pagePayload) attachPageFromPayload(pagePayload);
      }}
    >
      <div className={classes.header}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <input
            className={clsx(
              classes.titleInput,
              (!titleDraft || titleDraft === DEFAULT_DATABASE_TITLE) &&
                classes.titlePlaceholder,
            )}
            value={titleDraft}
            placeholder={t(DEFAULT_DATABASE_TITLE)}
            disabled={!canEditDatabase}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => setTitleDraft(event.currentTarget.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
          <Group gap={6} wrap="nowrap">
            <ActionIcon
              variant="subtle"
              aria-label={
                isFullscreen ? t("Exit fullscreen") : t("Open full page")
              }
              onClick={() => setIsFullscreen((value) => !value)}
            >
              {isFullscreen ? (
                <IconX size={16} />
              ) : (
                <IconArrowsMaximize size={16} />
              )}
            </ActionIcon>
            <ViewSettingsPopover
              activeView={activeView}
              fields={fields}
              sourceTitle={
                titleDraft || database?.title || DEFAULT_DATABASE_TITLE
              }
              filterField={filterField}
              filterText={filterText}
              sortField={sortField}
              sortDirection={sortDirection}
              onFilterFieldChange={(fieldName) => {
                setFilterField(fieldName);
                setFilterVisible(true);
              }}
              onFilterTextChange={(value) => {
                setFilterText(value);
                setFilterVisible(true);
              }}
              onClearFilter={() => {
                setFilterField(null);
                setFilterText("");
                setFilterVisible(false);
              }}
              onSortFieldChange={(fieldName) => {
                if (sortField === fieldName) {
                  setSortDirection((direction) =>
                    direction === "asc" ? "desc" : "asc",
                  );
                } else {
                  setSortField(fieldName);
                  setSortDirection("asc");
                }
              }}
              onClearSort={() => {
                setSortField(null);
                setSortDirection("asc");
              }}
            />
            {editor.isEditable && (
              <Menu shadow="md" width={220} position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon
                    variant="subtle"
                    aria-label={t("Board actions")}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <IconDots size={17} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    onClick={() => setDeleteModalOpened(true)}
                  >
                    {t(deleteActionLabel)}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
            {canEditDatabase && (
              <Button
                size="sm"
                className={classes.newButton}
                leftSection={<IconPlus size={15} />}
                loading={createRecordMutation.isPending}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (activeView.type === "kanban") {
                    setKanbanDraftStatus(statuses[0] || "Todo");
                    return;
                  }
                  createRecord();
                }}
              >
                {t("New")}
              </Button>
            )}
          </Group>
        </Group>
      </div>

      <Group className={classes.toolbar} justify="space-between" gap="xs">
        <div className={classes.viewTabs}>
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              className={clsx(
                classes.viewTab,
                view.id === activeView.id && classes.activeViewTab,
              )}
              onClick={() => setActiveViewId(view.id)}
            >
              <ViewIcon type={view.type} />
              <span>{viewLabel(view, t)}</span>
            </button>
          ))}
          {canEditDatabase && (
            <AddViewMenu
              existingViews={views}
              fields={fields}
              onCreateView={(view) => createViewMutation.mutate(view)}
            />
          )}
        </div>
        <Group gap={4} className={classes.toolbarActions}>
          <FieldPickerPopover
            icon={<IconFilter size={16} />}
            label="Filter"
            placeholder="Filter by..."
            fields={fields}
            active={filterVisible || Boolean(filterText)}
            footer="Add advanced filter"
            onFooterClick={() => {
              setFilterVisible(true);
              setFilterField(null);
            }}
            onSelect={(field) => {
              setFilterVisible(true);
              setFilterField(field.name);
            }}
          />
          <FieldPickerPopover
            icon={
              sortField && sortDirection === "desc" ? (
                <IconSortDescending size={16} />
              ) : (
                <IconArrowsSort size={16} />
              )
            }
            label="Sort"
            placeholder="Sort by..."
            fields={fields}
            active={Boolean(sortField)}
            onSelect={(field) => {
              if (sortField === field.name) {
                setSortDirection((direction) =>
                  direction === "asc" ? "desc" : "asc",
                );
                return;
              }
              setSortField(field.name);
              setSortDirection("asc");
            }}
          />
        </Group>
      </Group>

      {filterVisible && (
        <div
          className={classes.filterBar}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <IconFilter size={15} />
          <span>
            {filterField ? fieldLabel(filterField, t) : t("All properties")}
          </span>
          <input
            value={filterText}
            placeholder={t("Filter value...")}
            onChange={(event) => setFilterText(event.currentTarget.value)}
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              setFilterField(null);
              setFilterText("");
              setFilterVisible(false);
            }}
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      <div className={classes.body}>
        {hasOwnershipMismatch ? (
          <div className={classes.empty}>
            <Text fw={600}>{t("This board belongs to another page")}</Text>
            <Text size="sm" c="dimmed">
              {t(
                "Remove this invalid block without deleting the source board or its work items.",
              )}
            </Text>
            {editor.isEditable && (
              <Button
                variant="default"
                leftSection={<IconTrash size={15} />}
                onClick={() => setDeleteModalOpened(true)}
              >
                {t("Remove board block")}
              </Button>
            )}
          </div>
        ) : hasQueryError ? (
          <div className={classes.empty}>
            <Text fw={600}>{t("Database unavailable")}</Text>
            <Text size="sm" c="dimmed">
              {t("Check the APITable connection or try refreshing this page.")}
            </Text>
          </div>
        ) : isInitialLoading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : activeView.type === "kanban" ? (
          <KanbanView
            records={displayedRecords}
            allRecords={recordsWithViewStatus}
            statuses={statuses}
            groupFieldName={statusFieldName}
            canEdit={canEditDatabase}
            canEditStructure={canEditSchema}
            databaseId={databaseId}
            userById={userById}
            onOpen={setOpenedRecord}
            requestedDraftStatus={kanbanDraftStatus}
            onDraftRequestHandled={() => setKanbanDraftStatus(null)}
            onCreate={createRecord}
            onCreateColumn={(name, afterStatus) => {
              const nextOption = uniqueOptionName(name, statuses);
              const nextOptions = [...statuses];
              const anchorIndex = afterStatus
                ? nextOptions.indexOf(afterStatus)
                : -1;
              nextOptions.splice(
                anchorIndex >= 0 ? anchorIndex + 1 : nextOptions.length,
                0,
                nextOption,
              );
              if (statusField) {
                updateFieldMutation.mutate({
                  fieldName: statusField.name,
                  options: nextOptions,
                });
                return;
              }
              createFieldMutation.mutate({
                name: statusFieldName,
                type: "status",
                options: nextOptions,
              });
            }}
            onRenameColumn={(status, name) => {
              const nextOption = uniqueOptionName(
                name,
                statuses.filter((option) => option !== status),
              );
              if (nextOption === status) return;

              const nextOptions = statuses.map((option) =>
                option === status ? nextOption : option,
              );
              if (statusField) {
                updateFieldOptionMutation.mutate({
                  fieldName: statusField.name,
                  operation: "rename",
                  option: status,
                  name: nextOption,
                });
              } else {
                createFieldMutation.mutate({
                  name: statusFieldName,
                  type: "status",
                  options: nextOptions,
                });
              }
            }}
            onDeleteColumn={(status) => {
              const nextOptions = statuses.filter(
                (option) => option !== status,
              );
              if (
                nextOptions.length === statuses.length ||
                nextOptions.length === 0
              )
                return;

              if (statusField) {
                updateFieldOptionMutation.mutate({
                  fieldName: statusField.name,
                  operation: "delete",
                  option: status,
                  replacementOption: nextOptions[0],
                });
                return;
              }
              createFieldMutation.mutate({
                name: statusFieldName,
                type: "status",
                options: nextOptions,
              });
            }}
            onAttachPage={(payload, fields) =>
              attachPageFromPayload(payload, fields)
            }
            onMoveToBoard={setBoardMoveRecord}
            onMoveToTrash={moveRecordPageToTrash}
            onMoveRecord={(recordId, status, beforeRecordId) => {
              const record = recordsWithViewStatus.find(
                (item) => item.id === recordId,
              );
              const statusChanged = record?.status !== status;
              if (statusChanged)
                updateRecord(recordId, { [statusFieldName]: status });

              if (manualReorderDisabled) {
                if (beforeRecordId || !statusChanged) {
                  notifyManualReorderDisabled();
                }
                return;
              }

              reorderRecord(recordId, beforeRecordId);
            }}
            onUpdateTitle={(recordId, title) =>
              updateRecord(recordId, { Title: title })
            }
          />
        ) : activeView.type === "gallery" ? (
          <GalleryView
            records={displayedRecords}
            canEdit={canEditDatabase}
            databaseId={databaseId}
            onOpen={setOpenedRecord}
            onAttachPage={attachPageFromPayload}
            onReorderRecord={reorderRecord}
          />
        ) : activeView.type === "calendar" ? (
          <CalendarView
            records={displayedRecords}
            canEdit={canEditDatabase}
            databaseId={databaseId}
            onOpen={setOpenedRecord}
            onAttachPage={attachPageFromPayload}
            onReorderRecord={reorderRecord}
            onUpdateRecord={updateRecord}
          />
        ) : activeView.type === "list" ? (
          <ListView
            records={displayedRecords}
            canEdit={canEditDatabase}
            databaseId={databaseId}
            onOpen={setOpenedRecord}
            onOpenFullPage={openFullPage}
            onAttachPage={attachPageFromPayload}
            onReorderRecord={reorderRecord}
          />
        ) : activeView.type === "timeline" ? (
          <TimelineView
            records={displayedRecords}
            canEdit={canEditDatabase}
            databaseId={databaseId}
            onOpen={setOpenedRecord}
            onAttachPage={attachPageFromPayload}
            onReorderRecord={reorderRecord}
            onUpdateRecord={updateRecord}
          />
        ) : ["chart", "dashboard", "feed", "map", "form"].includes(
            activeView.type,
          ) ? (
          <SecondaryView
            type={activeView.type}
            records={displayedRecords}
            databaseId={databaseId}
            onOpen={setOpenedRecord}
            onCreate={(fields) => createRecordWithFields(fields)}
            onAttachPage={attachPageFromPayload}
            onReorderRecord={reorderRecord}
            canEdit={canEditDatabase}
          />
        ) : (
          <TableView
            records={displayedRecords}
            fields={fields}
            statuses={statuses}
            statusFieldName={statusFieldName}
            users={userOptions}
            canEdit={canEditDatabase}
            canEditSchema={canEditSchema}
            databaseId={databaseId}
            onCreate={() => createRecord()}
            onOpen={setOpenedRecord}
            onOpenFullPage={openFullPage}
            onAttachPage={attachPageFromPayload}
            onAssigneeSearch={setUserSearch}
            onUpdateRecord={updateRecord}
            onReorderRecord={reorderRecord}
            onFilterField={(fieldName) => {
              setFilterVisible(true);
              setFilterField(fieldName);
            }}
            onSortField={(fieldName) => {
              if (sortField === fieldName) {
                setSortDirection((direction) =>
                  direction === "asc" ? "desc" : "asc",
                );
              } else {
                setSortField(fieldName);
                setSortDirection("asc");
              }
            }}
            onCreateField={(input) => createFieldMutation.mutate(input)}
            onUpdateField={(input) => updateFieldMutation.mutate(input)}
          />
        )}
      </div>

      <BoardPickerModal
        opened={Boolean(boardMoveRecord)}
        onClose={() => setBoardMoveRecord(null)}
        targets={boardTargetsQuery.data ?? []}
        loading={
          boardTargetsQuery.isLoading || attachPageToDatabaseMutation.isPending
        }
        onSelect={moveRecordToBoard}
      />

      <RecordSidePage
        opened={Boolean(openedRecord)}
        record={openedRecord}
        fields={fields}
        statuses={statuses}
        statusFieldName={statusFieldName}
        users={userOptions}
        canEdit={canEditDatabase && openedRecord?.canEdit !== false}
        canEditSchema={canEditSchema}
        onClose={() => setOpenedRecord(null)}
        onOpenFullPage={() => openFullPage(openedRecord)}
        onAssigneeSearch={setUserSearch}
        onUpdate={(recordId, nextFields) => updateRecord(recordId, nextFields)}
        onCreateField={(input) => createFieldMutation.mutate(input)}
        onUpdateField={(input) => updateFieldMutation.mutate(input)}
      />

      <Modal
        opened={deleteModalOpened}
        onClose={() => {
          if (!deleteDatabaseMutation.isPending) setDeleteModalOpened(false);
        }}
        title={t(deleteActionLabel)}
        centered
        size="md"
        closeOnClickOutside={!deleteDatabaseMutation.isPending}
        closeOnEscape={!deleteDatabaseMutation.isPending}
        onClick={(event) => event.stopPropagation()}
      >
        <Stack gap="md">
          {hasOwnershipMismatch ? (
            <>
              <Text size="sm">{t("This board belongs to another page")}</Text>
              <Text size="sm" c="dimmed">
                {t(
                  "Remove this invalid block without deleting the source board or its work items.",
                )}
              </Text>
            </>
          ) : hasDuplicateOwnerReference ? (
            <>
              <Text size="sm">
                {t("This board appears more than once on this page")}
              </Text>
              <Text size="sm" c="dimmed">
                {t(
                  "Remove this duplicate block without deleting the shared board or its work items.",
                )}
              </Text>
            </>
          ) : externalDatabase ? (
            <>
              <Text size="sm">
                {t(
                  "This removes the board from Docmost. The external APITable datasheet and its records will not be deleted.",
                )}
              </Text>
              <Text size="sm" c="dimmed">
                {t("Manage the external data in APITable.")}
              </Text>
            </>
          ) : (
            <>
              <Text size="sm">
                {t(
                  "This will delete the board and move all work item pages, including their child pages, to trash.",
                )}
              </Text>
              <Text size="sm" c="dimmed">
                {t(
                  "The board cannot be restored. Work item pages can still be restored from trash as regular pages.",
                )}
              </Text>
            </>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={deleteDatabaseMutation.isPending}
              onClick={() => setDeleteModalOpened(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              color="red"
              loading={deleteDatabaseMutation.isPending}
              onClick={() => void confirmDeleteDatabase()}
            >
              {t(deleteActionLabel)}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </NodeViewWrapper>
  );
}

function BoardPickerModal({
  opened,
  onClose,
  targets,
  loading,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  targets: DatabaseBoardTarget[];
  loading: boolean;
  onSelect: (target: DatabaseBoardTarget) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!opened) setQuery("");
  }, [opened]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredTargets = normalizedQuery
    ? targets.filter((target) =>
        [target.title, target.pageTitle]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery)),
      )
    : targets;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Move to another board...")}
      size={520}
      yOffset="10vh"
      onClick={(event) => event.stopPropagation()}
    >
      <Stack gap="sm">
        <TextInput
          value={query}
          leftSection={<IconSearch size={15} />}
          placeholder={t("Search boards...")}
          onChange={(event) => setQuery(event.currentTarget.value)}
          autoFocus
        />
        <Stack gap={4}>
          {loading ? (
            <Group justify="center" p="md">
              <Loader size="sm" />
            </Group>
          ) : filteredTargets.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              {t("No editable boards found")}
            </Text>
          ) : (
            filteredTargets.map((target) => (
              <Button
                key={target.id}
                variant="subtle"
                color="gray"
                justify="flex-start"
                leftSection={<IconLayoutBoard size={16} />}
                onClick={() => void onSelect(target)}
              >
                <Stack gap={0} align="flex-start">
                  <Text size="sm" fw={500}>
                    {target.title || t("Untitled")}
                  </Text>
                  {target.pageTitle && (
                    <Text size="xs" c="dimmed">
                      {target.pageTitle}
                    </Text>
                  )}
                </Stack>
              </Button>
            ))
          )}
        </Stack>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function KanbanView({
  records,
  allRecords,
  statuses,
  groupFieldName,
  canEdit,
  canEditStructure,
  databaseId,
  userById,
  onOpen,
  requestedDraftStatus,
  onDraftRequestHandled,
  onCreate,
  onCreateColumn,
  onRenameColumn,
  onDeleteColumn,
  onAttachPage,
  onMoveToBoard,
  onMoveToTrash,
  onMoveRecord,
  onUpdateTitle,
}: {
  records: DatabaseRecord[];
  allRecords: DatabaseRecord[];
  statuses: string[];
  groupFieldName: string;
  canEdit: boolean;
  canEditStructure: boolean;
  databaseId?: string;
  userById: Map<string, DatabaseUser>;
  onOpen: (record: DatabaseRecord) => void;
  requestedDraftStatus: string | null;
  onDraftRequestHandled: () => void;
  onCreate: (status: string, title?: string) => Promise<boolean>;
  onCreateColumn: (name: string, afterStatus?: string) => void;
  onRenameColumn: (status: string, name: string) => void;
  onDeleteColumn: (status: string) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onMoveToBoard: (record: DatabaseRecord) => void;
  onMoveToTrash: (record: DatabaseRecord) => void;
  onMoveRecord: (
    recordId: string,
    status: string,
    beforeRecordId?: string,
  ) => void;
  onUpdateTitle: (recordId: string, title: string) => void;
}) {
  const { t } = useTranslation();
  const ADD_COLUMN_AT_END = "__end__";
  const [addingColumnAfter, setAddingColumnAfter] = useState<string | null>(
    null,
  );
  const [columnDraft, setColumnDraft] = useState("");
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const columnRenameCancelledRef = useRef(false);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [dropColumnStatus, setDropColumnStatus] = useState<string | null>(null);
  const [dropTargetRecordId, setDropTargetRecordId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!requestedDraftStatus) return;
    setDraftStatus(requestedDraftStatus);
    onDraftRequestHandled();
  }, [onDraftRequestHandled, requestedDraftStatus]);

  const commitColumn = () => {
    const nextName = columnDraft.trim();
    if (!nextName) {
      setAddingColumnAfter(null);
      return;
    }
    onCreateColumn(
      nextName,
      addingColumnAfter === ADD_COLUMN_AT_END
        ? undefined
        : (addingColumnAfter ?? undefined),
    );
    setColumnDraft("");
    setAddingColumnAfter(null);
  };

  const renderAddColumnInput = (afterStatus: string | null) => (
    <div className={clsx(classes.column, classes.addColumnPanel)}>
      <input
        autoFocus
        className={classes.addColumnInput}
        value={columnDraft}
        placeholder={t("New group")}
        onChange={(event) => setColumnDraft(event.currentTarget.value)}
        onBlur={commitColumn}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitColumn();
          if (event.key === "Escape") {
            setColumnDraft("");
            setAddingColumnAfter(null);
          }
        }}
      />
    </div>
  );

  const startAddingColumn = (afterStatus: string | null) => {
    setColumnDraft("");
    setAddingColumnAfter(afterStatus ?? ADD_COLUMN_AT_END);
  };

  const startRenamingColumn = (status: string) => {
    columnRenameCancelledRef.current = false;
    setRenameDraft(status);
    setRenamingColumn(status);
  };

  const commitColumnRename = () => {
    const current = renamingColumn;
    const nextName = renameDraft.trim();
    const cancelled = columnRenameCancelledRef.current;
    columnRenameCancelledRef.current = false;
    setRenamingColumn(null);
    setRenameDraft("");
    if (cancelled) return;
    if (!current || !nextName || nextName === current) return;
    onRenameColumn(current, nextName);
  };

  const startDraft = (status: string) => {
    setDraftStatus(status);
  };

  return (
    <div className={classes.board}>
      {statuses.map((status, index) => {
        const columnRecords = records.filter(
          (record) => record.status === status,
        );
        const totalColumnRecordCount = allRecords.filter(
          (record) => record.status === status,
        ).length;
        return (
          <Fragment key={status}>
            <div
              data-database-drop-zone="true"
              data-database-kanban-status={status}
              className={clsx(
                classes.column,
                classes[`columnTone${(index % 4) + 1}`],
                dropColumnStatus === status && classes.columnDropTarget,
              )}
              onDragOver={(event) => {
                if (!canEdit) return;
                if (!hasDocmostDatabaseDrag(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                setDropColumnStatus(status);
              }}
              onDragLeave={(event) => {
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  return;
                setDropColumnStatus((value) =>
                  value === status ? null : value,
                );
              }}
              onDrop={(event) => {
                if (!canEdit) return;
                const recordId = getDraggedRecordId(event.dataTransfer);
                const pagePayload = pagePayloadFromDrag(event.dataTransfer);
                if (
                  recordId &&
                  isSameDatabaseDrag(
                    pagePayload,
                    databaseId,
                    event.dataTransfer,
                  )
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  setDropColumnStatus(null);
                  setDropTargetRecordId(null);
                  onMoveRecord(recordId, status);
                  return;
                }
                if (pagePayload) {
                  event.preventDefault();
                  event.stopPropagation();
                  setDropColumnStatus(null);
                  setDropTargetRecordId(null);
                  onAttachPage(pagePayload, { [groupFieldName]: status });
                }
              }}
            >
              <Group justify="space-between" mb="xs" align="center">
                {renamingColumn === status ? (
                  <input
                    autoFocus
                    className={classes.columnNameInput}
                    value={renameDraft}
                    onChange={(event) =>
                      setRenameDraft(event.currentTarget.value)
                    }
                    onBlur={commitColumnRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === "Escape") {
                        columnRenameCancelledRef.current = true;
                        event.preventDefault();
                        setRenamingColumn(null);
                        setRenameDraft("");
                      }
                    }}
                  />
                ) : (
                  <Badge className={classes.columnBadge} variant="light">
                    {t(status)}
                  </Badge>
                )}
                <Group gap={3} className={classes.columnActions}>
                  {canEditStructure && (
                    <Menu
                      shadow="md"
                      width={190}
                      position="bottom-end"
                      withinPortal
                    >
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label={t("Column actions")}
                          onMouseDown={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <IconDots size={15} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Menu.Item
                          leftSection={<IconSettings size={15} />}
                          onClick={() => startRenamingColumn(status)}
                        >
                          {t("Rename")}
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconArrowBarToRight size={15} />}
                          onClick={() => startAddingColumn(status)}
                        >
                          {t("New group")}
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={15} />}
                          disabled={
                            totalColumnRecordCount > 0 || statuses.length <= 1
                          }
                          onClick={() => onDeleteColumn(status)}
                        >
                          {t("Delete empty group")}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                  {canEditStructure && (
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t("New group")}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        startAddingColumn(status);
                      }}
                    >
                      <IconArrowBarToRight size={15} />
                    </ActionIcon>
                  )}
                  {canEdit && (
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={t("New")}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        startDraft(status);
                      }}
                    >
                      <IconPlus size={15} />
                    </ActionIcon>
                  )}
                </Group>
              </Group>
              <Stack gap="xs">
                {columnRecords.map((record) => (
                  <TaskCard
                    key={record.id}
                    record={record}
                    userById={userById}
                    status={status}
                    databaseId={databaseId}
                    onOpen={onOpen}
                    onMoveToBoard={onMoveToBoard}
                    onMoveToTrash={onMoveToTrash}
                    onUpdateTitle={(title) => onUpdateTitle(record.id, title)}
                    onMoveRecord={onMoveRecord}
                    onAttachPage={onAttachPage}
                    groupFieldName={groupFieldName}
                    isDropTarget={dropTargetRecordId === record.id}
                    onDragOverRecord={() => {
                      setDropTargetRecordId(record.id);
                      setDropColumnStatus(status);
                    }}
                    onClearDropTarget={() => {
                      setDropTargetRecordId(null);
                      setDropColumnStatus(null);
                    }}
                    canEdit={canEdit && record.canEdit !== false}
                  />
                ))}
                {canEdit && draftStatus === status && (
                  <DraftTaskCard
                    onCreate={async (title) => {
                      const created = await onCreate(status, title);
                      if (created) setDraftStatus(null);
                      return created;
                    }}
                    onCancel={() => setDraftStatus(null)}
                  />
                )}
                {canEdit && (
                  <button
                    type="button"
                    className={classes.newPageButton}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      startDraft(status);
                    }}
                  >
                    <IconPlus size={16} />
                    {t("New task")}
                  </button>
                )}
              </Stack>
            </div>
            {addingColumnAfter === status && renderAddColumnInput(status)}
          </Fragment>
        );
      })}
      {canEditStructure &&
        (addingColumnAfter === ADD_COLUMN_AT_END ? (
          renderAddColumnInput(null)
        ) : (
          <div className={clsx(classes.column, classes.addColumnPanel)}>
            <button
              type="button"
              className={classes.addColumnButton}
              onClick={() => startAddingColumn(null)}
            >
              <IconPlus size={16} />
              {t("New group")}
            </button>
          </div>
        ))}
    </div>
  );
}

function DraftTaskCard({
  onCreate,
  onCancel,
}: {
  onCreate: (title: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const commit = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || submittedRef.current) return;
    submittedRef.current = true;
    setIsSubmitting(true);
    const created = await onCreate(nextTitle);
    if (!created) submittedRef.current = false;
    setIsSubmitting(false);
  };

  return (
    <div className={clsx(classes.card, classes.draftCard)}>
      <div className={classes.cardMain}>
        <input
          autoFocus
          className={classes.cardTitleInput}
          value={title}
          disabled={isSubmitting}
          placeholder={t("Task name...")}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onBlur={() => (title.trim() ? void commit() : onCancel())}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      </div>
    </div>
  );
}

function TaskCard({
  record,
  userById,
  status,
  databaseId,
  onOpen,
  onMoveToBoard,
  onMoveToTrash,
  onUpdateTitle,
  onMoveRecord,
  onAttachPage,
  groupFieldName,
  isDropTarget,
  onDragOverRecord,
  onClearDropTarget,
  canEdit,
}: {
  record: DatabaseRecord;
  userById: Map<string, DatabaseUser>;
  status: string;
  databaseId?: string;
  onOpen: (record: DatabaseRecord) => void;
  onMoveToBoard: (record: DatabaseRecord) => void;
  onMoveToTrash: (record: DatabaseRecord) => void;
  onUpdateTitle: (title: string) => void;
  onMoveRecord: (
    recordId: string,
    status: string,
    beforeRecordId?: string,
  ) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  groupFieldName: string;
  isDropTarget: boolean;
  onDragOverRecord: () => void;
  onClearDropTarget: () => void;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(record.title);

  useEffect(() => {
    setTitle(record.title);
  }, [record.title]);

  return (
    <div
      className={clsx(classes.card, isDropTarget && classes.cardDropTarget)}
      draggable={canEdit}
      onDragStart={(event) => {
        if (!canEdit) return;
        const target = event.target as HTMLElement;
        if (shouldSkipRecordDrag(target)) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        setRecordDragData(event.dataTransfer, record, databaseId);
      }}
      onDragEnd={clearDocmostDragPayloads}
      onDragOver={(event) => {
        if (!canEdit) return;
        if (!hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        onDragOverRecord();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        onClearDropTarget();
      }}
      onDrop={(event) => {
        if (!canEdit) return;
        const recordId = getDraggedRecordId(event.dataTransfer);
        const pagePayload = pagePayloadFromDrag(event.dataTransfer);
        if (!recordId && !pagePayload) return;
        event.preventDefault();
        event.stopPropagation();
        onClearDropTarget();
        if (
          recordId &&
          isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
        ) {
          if (recordId !== record.id) onMoveRecord(recordId, status, record.id);
          return;
        }
        if (pagePayload)
          onAttachPage(pagePayload, { [groupFieldName]: status });
      }}
    >
      <div className={classes.cardMain}>
        <input
          className={classes.cardTitleInput}
          value={title}
          placeholder={t("Type a name...")}
          disabled={!canEdit}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onBlur={() => {
            if (title !== record.title) onUpdateTitle(title);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <Group gap={6} mt={8}>
          {record.priority && (
            <Badge size="xs" variant="light">
              {translatedValue(record.priority, t)}
            </Badge>
          )}
          {record.dueDate && (
            <Badge size="xs" color="gray" variant="light">
              {record.dueDate}
            </Badge>
          )}
        </Group>
      </div>
      <Menu shadow="md" width={220} position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            className={classes.cardMenuButton}
            variant="subtle"
            size="sm"
            aria-label={t("Card actions")}
            data-no-row-drag
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <Menu.Item
            leftSection={<IconArrowsMaximize size={15} />}
            onClick={() => onOpen(record)}
          >
            {t("Open page")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconLayoutBoard size={15} />}
            disabled={!record.pageId || !canEdit}
            onClick={() => onMoveToBoard(record)}
          >
            {t("Move to another board...")}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={15} />}
            disabled={!record.pageId || !canEdit}
            onClick={() => onMoveToTrash(record)}
          >
            {t("Move to trash")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {record.assigneeIds.length > 0 && (
        <div className={classes.cardAssignees}>
          {record.assigneeIds.slice(0, 3).map((id) => {
            const user = userById.get(id);
            return (
              <span key={id} className={classes.assigneeChip}>
                <CustomAvatar
                  size="xs"
                  name={user?.name || id}
                  avatarUrl={user?.avatarUrl}
                />
                <span>{user?.name || user?.email || id}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TableView({
  records,
  fields,
  statuses,
  statusFieldName,
  users,
  databaseId,
  onOpen,
  onOpenFullPage,
  onCreate,
  onAttachPage,
  onAssigneeSearch,
  onUpdateRecord,
  onReorderRecord,
  onFilterField,
  onSortField,
  onCreateField,
  onUpdateField,
  canEdit,
  canEditSchema,
}: {
  records: DatabaseRecord[];
  fields: DatabaseFieldDefinition[];
  statuses: string[];
  statusFieldName: string;
  users: PeopleOption[];
  databaseId?: string;
  onOpen: (record: DatabaseRecord) => void;
  onOpenFullPage: (record: DatabaseRecord) => void;
  onCreate: (fields?: Record<string, unknown>) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onAssigneeSearch: (query: string) => void;
  onUpdateRecord: (recordId: string, fields: Record<string, unknown>) => void;
  onReorderRecord: (recordId: string, beforeRecordId?: string) => void;
  onFilterField: (fieldName: string) => void;
  onSortField: (fieldName: string) => void;
  onCreateField: (input: CreateFieldInput) => void;
  onUpdateField: (input: UpdateFieldInput) => void;
  canEdit: boolean;
  canEditSchema: boolean;
}) {
  const { t } = useTranslation();
  const visibleFields = fields.length
    ? fields
    : [{ name: TITLE_FIELD, type: "text" as const }];
  const defaultWidths = useMemo<number[]>(
    () =>
      visibleFields.map((field, index) =>
        index === 0 || field.name === TITLE_FIELD ? 300 : 170,
      ),
    [visibleFields],
  );
  const [columnWidths, setColumnWidths] = useState(defaultWidths);
  const [dropTargetRecordId, setDropTargetRecordId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setColumnWidths(defaultWidths);
  }, [defaultWidths]);

  const startColumnResize = (
    index: number,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[index] ?? defaultWidths[index] ?? 170;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(120, startWidth + moveEvent.clientX - startX);
      setColumnWidths((widths) =>
        widths.map((width, widthIndex) =>
          widthIndex === index ? nextWidth : width,
        ),
      );
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      data-database-drop-zone="true"
      className={classes.tableWrap}
      role="table"
      aria-label={t("Database")}
      onDragOver={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const recordId = getDraggedRecordId(event.dataTransfer);
        const pagePayload = pagePayloadFromDrag(event.dataTransfer);
        if (
          recordId &&
          isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
        ) {
          setDropTargetRecordId(null);
          onReorderRecord(recordId);
          return;
        }
        if (pagePayload) {
          setDropTargetRecordId(null);
          onAttachPage(pagePayload);
        }
      }}
    >
      <div
        className={classes.tableGrid}
        style={{
          gridTemplateColumns: `${columnWidths.map((width) => `${width}px`).join(" ")} minmax(190px, .8fr)`,
        }}
      >
        {visibleFields.map((field, index) => (
          <PropertyHeader
            key={field.name}
            field={field}
            width={columnWidths[index] ?? defaultWidths[index]}
            canEdit={canEditSchema}
            onCreateField={onCreateField}
            onUpdateField={onUpdateField}
            onFilterField={onFilterField}
            onSortField={onSortField}
            onResizeStart={(event) => startColumnResize(index, event)}
          />
        ))}
        <AddPropertyHeader
          canEdit={canEditSchema}
          onCreateField={onCreateField}
        />

        {records.map((record) => (
          <RecordRow
            key={record.id}
            record={record}
            fields={visibleFields}
            statuses={statuses}
            statusFieldName={statusFieldName}
            users={users}
            canEdit={isRecordEditable(canEdit, record)}
            databaseId={databaseId}
            isDropTarget={dropTargetRecordId === record.id}
            onOpen={onOpen}
            onOpenFullPage={onOpenFullPage}
            onCreate={onCreate}
            onAttachPage={onAttachPage}
            onAssigneeSearch={onAssigneeSearch}
            onUpdateRecord={onUpdateRecord}
            onReorderRecord={onReorderRecord}
            onDragOverRecord={() => setDropTargetRecordId(record.id)}
            onClearDropTarget={() => setDropTargetRecordId(null)}
          />
        ))}
      </div>
      {canEdit && (
        <button
          type="button"
          className={classes.newRowButton}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onCreate();
          }}
        >
          <IconPlus size={16} />
          {t("New page")}
        </button>
      )}
    </div>
  );
}

function RecordRow({
  record,
  fields,
  statuses,
  statusFieldName,
  users,
  canEdit,
  databaseId,
  isDropTarget,
  onOpen,
  onOpenFullPage,
  onCreate,
  onAttachPage,
  onAssigneeSearch,
  onUpdateRecord,
  onReorderRecord,
  onDragOverRecord,
  onClearDropTarget,
}: {
  record: DatabaseRecord;
  fields: DatabaseFieldDefinition[];
  statuses: string[];
  statusFieldName: string;
  users: PeopleOption[];
  canEdit: boolean;
  databaseId?: string;
  isDropTarget: boolean;
  onOpen: (record: DatabaseRecord) => void;
  onOpenFullPage: (record: DatabaseRecord) => void;
  onCreate: (fields?: Record<string, unknown>) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onAssigneeSearch: (query: string) => void;
  onUpdateRecord: (recordId: string, fields: Record<string, unknown>) => void;
  onReorderRecord: (recordId: string, beforeRecordId?: string) => void;
  onDragOverRecord: () => void;
  onClearDropTarget: () => void;
}) {
  const handleRowDragStart = (event: ReactDragEvent<HTMLElement>) => {
    if (!canEdit) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    setRecordDragData(event.dataTransfer, record, databaseId);
  };

  return (
    <>
      <div
        className={clsx(
          classes.rowDragDropZone,
          isDropTarget && classes.rowDragDropZoneActive,
        )}
        onDragOver={(event) => {
          if (!canEdit) return;
          if (!hasDocmostDatabaseDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          onDragOverRecord();
        }}
        onDrop={(event) => {
          if (!canEdit) return;
          const recordId = getDraggedRecordId(event.dataTransfer);
          const pagePayload = pagePayloadFromDrag(event.dataTransfer);
          if (!recordId && !pagePayload) return;
          event.preventDefault();
          event.stopPropagation();
          onClearDropTarget();
          if (
            recordId &&
            isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
          ) {
            if (recordId !== record.id) onReorderRecord(recordId, record.id);
            return;
          }
          if (pagePayload) onAttachPage(pagePayload);
        }}
      />
      {fields.map((field) => (
        <EditableTableCell
          key={`${record.id}-${field.name}`}
          record={record}
          field={field}
          statuses={statuses}
          statusFieldName={statusFieldName}
          users={users}
          canEdit={canEdit}
          databaseId={databaseId}
          isDropTarget={isDropTarget}
          onOpen={onOpen}
          onOpenFullPage={onOpenFullPage}
          onCreate={onCreate}
          onAssigneeSearch={onAssigneeSearch}
          onDragOverRecord={onDragOverRecord}
          onClearDropTarget={onClearDropTarget}
          onRowDragStart={handleRowDragStart}
          onDropRecord={(draggedRecordId) => {
            if (draggedRecordId !== record.id)
              onReorderRecord(draggedRecordId, record.id);
          }}
          onAttachPage={(payload) => onAttachPage(payload)}
          onUpdate={(value) =>
            onUpdateRecord(record.id, { [field.name]: value })
          }
        />
      ))}
      <div
        className={clsx(
          classes.tableCellFiller,
          isDropTarget && classes.tableCellRowDrop,
        )}
      />
    </>
  );
}

function PropertyHeader({
  field,
  width,
  canEdit,
  onCreateField,
  onUpdateField,
  onFilterField,
  onSortField,
  onResizeStart,
}: {
  field: DatabaseFieldDefinition;
  width: number;
  canEdit: boolean;
  onCreateField: (input: CreateFieldInput) => void;
  onUpdateField: (input: UpdateFieldInput) => void;
  onFilterField: (fieldName: string) => void;
  onSortField: (fieldName: string) => void;
  onResizeStart: (event: ReactMouseEvent<HTMLSpanElement>) => void;
}) {
  const { t } = useTranslation();
  const Icon =
    field.name === TITLE_FIELD ? IconFileText : fieldTypeIcon(field.type);

  return (
    <Popover
      width={420}
      shadow="md"
      position="bottom-start"
      disabled={!canEdit}
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.tableHeaderCell}
          role="columnheader"
          style={{ width }}
        >
          <Icon size={15} />
          <span>{fieldLabel(field.name, t)}</span>
          <span
            className={classes.columnResizeHandle}
            onMouseDown={onResizeStart}
          />
        </button>
      </Popover.Target>
      <Popover.Dropdown className={classes.propertyPopover}>
        <PropertyEditor
          field={field}
          onCreateField={onCreateField}
          onUpdateField={onUpdateField}
          onFilterField={onFilterField}
          onSortField={onSortField}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

function AddPropertyHeader({
  canEdit,
  onCreateField,
}: {
  canEdit: boolean;
  onCreateField: (input: CreateFieldInput) => void;
}) {
  const { t } = useTranslation();

  if (!canEdit) return <div className={classes.addPropertyHeader} />;

  return (
    <Popover width={520} shadow="md" position="bottom-start" withinPortal>
      <Popover.Target>
        <button type="button" className={classes.addPropertyHeader}>
          <IconPlus size={18} />
          {t("Add property")}
        </button>
      </Popover.Target>
      <Popover.Dropdown className={classes.propertyPopover}>
        <PropertyEditor onCreateField={onCreateField} />
      </Popover.Dropdown>
    </Popover>
  );
}

function PropertyEditor({
  field,
  onCreateField,
  onUpdateField,
  onFilterField,
  onSortField,
}: {
  field?: DatabaseFieldDefinition;
  onCreateField?: (input: CreateFieldInput) => void;
  onUpdateField?: (input: UpdateFieldInput) => void;
  onFilterField?: (fieldName: string) => void;
  onSortField?: (fieldName: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(
    field?.name && field.name !== TITLE_FIELD ? field.name : "",
  );
  const [selectedType, setSelectedType] = useState<
    DatabaseFieldDefinition["type"]
  >(field?.type || "text");
  const [typeQuery, setTypeQuery] = useState("");
  const [options, setOptions] = useState<string[]>(
    field?.options ?? defaultOptionsForType(field?.type || "text") ?? [],
  );
  const [optionDraft, setOptionDraft] = useState("");
  const SelectedIcon = field ? fieldTypeIcon(field.type) : IconMoodSmile;

  useEffect(() => {
    setName(field?.name && field.name !== TITLE_FIELD ? field.name : "");
    setSelectedType(field?.type || "text");
    setOptions(
      field?.options ?? defaultOptionsForType(field?.type || "text") ?? [],
    );
    setOptionDraft("");
  }, [field?.name, field?.options, field?.type]);

  const filteredPropertyTypes = PROPERTY_TYPES.filter((typeOption) =>
    t(typeOption.label).toLowerCase().includes(typeQuery.trim().toLowerCase()),
  );

  const commitExisting = () => {
    if (!field || field.name === TITLE_FIELD) return;
    const nextName = name.trim();
    if (nextName && nextName !== field.name) {
      onUpdateField?.({ fieldName: field.name, name: nextName });
    }
  };

  const handleTypeClick = (
    type: DatabaseFieldDefinition["type"],
    disabled?: boolean,
  ) => {
    if (disabled) return;
    setSelectedType(type);
    setOptions(defaultOptionsForType(type) ?? []);
    if (field) {
      onUpdateField?.({
        fieldName: field.name,
        type,
        name: name.trim() || undefined,
        options: defaultOptionsForType(type) ?? field.options,
      });
      return;
    }
    onCreateField?.({
      name: name.trim() || undefined,
      type,
      options: defaultOptionsForType(type),
      position: "end",
    });
  };

  const commitOptions = (nextOptions: string[]) => {
    const normalizedOptions = normalizeOptions(nextOptions);
    setOptions(normalizedOptions);
    if (field && supportsOptions(selectedType)) {
      onUpdateField?.({ fieldName: field.name, options: normalizedOptions });
    }
  };

  const addOption = () => {
    const nextOption = optionDraft.trim();
    if (!nextOption) return;
    commitOptions([...options, nextOption]);
    setOptionDraft("");
  };

  return (
    <div
      className={classes.propertyMenu}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className={classes.propertyNameInputWrap}>
        <SelectedIcon size={20} />
        <input
          className={classes.propertyNameInput}
          value={field?.name === TITLE_FIELD ? t("Name") : name}
          disabled={field?.name === TITLE_FIELD}
          placeholder={t("Type property name...")}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={commitExisting}
          autoFocus={!field}
        />
      </div>

      {field?.name === TITLE_FIELD && (
        <div className={classes.propertySwitch}>
          <IconMoodSmile size={17} />
          <span>{t("Show page icon")}</span>
          <Switch checked readOnly size="sm" />
        </div>
      )}

      {field && (
        <>
          <div className={classes.propertySeparator} />
          <button
            type="button"
            className={classes.propertyMenuItem}
            onClick={() => onFilterField?.(field.name)}
          >
            <IconFilter size={20} />
            {t("Filter")}
          </button>
          <button
            type="button"
            className={classes.propertyMenuItem}
            onClick={() => onSortField?.(field.name)}
          >
            <IconArrowsSort size={20} />
            {t("Sort")}
            <IconChevronRight size={18} className={classes.menuChevron} />
          </button>
        </>
      )}

      <div className={classes.propertySeparator} />
      <div className={classes.propertyMenuLabel}>{t("Select type")}</div>
      <label className={classes.propertyTypeSearch}>
        <IconSearch size={15} />
        <input
          value={typeQuery}
          placeholder={t("Search property type...")}
          onChange={(event) => setTypeQuery(event.currentTarget.value)}
        />
      </label>
      <div className={classes.propertyTypeGrid}>
        {filteredPropertyTypes.map((typeOption) => {
          const TypeIcon = typeOption.icon;
          return (
            <button
              key={typeOption.type}
              type="button"
              className={clsx(
                classes.propertyTypeButton,
                selectedType === typeOption.type &&
                  classes.propertyTypeButtonActive,
              )}
              disabled={typeOption.disabled}
              onClick={() =>
                handleTypeClick(typeOption.type, typeOption.disabled)
              }
            >
              <TypeIcon size={20} />
              <span>{t(typeOption.label)}</span>
            </button>
          );
        })}
      </div>

      {field && field.name !== TITLE_FIELD && supportsOptions(selectedType) && (
        <>
          <div className={classes.propertySeparator} />
          <div className={classes.propertyMenuLabel}>{t("Options")}</div>
          <div className={classes.optionEditorList}>
            {options.map((option, index) => (
              <div
                key={`${option}-${index}`}
                className={classes.optionEditorRow}
              >
                <span
                  className={classes.optionColorDot}
                  data-tone={optionTone(option, index)}
                />
                <input
                  value={option}
                  onChange={(event) =>
                    setOptions((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? event.currentTarget.value : item,
                      ),
                    )
                  }
                  onBlur={() => commitOptions(options)}
                />
                <button
                  type="button"
                  aria-label={t("Delete option")}
                  onClick={() =>
                    commitOptions(
                      options.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className={classes.optionAddRow}>
            <input
              value={optionDraft}
              placeholder={t("Add option")}
              onChange={(event) => setOptionDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addOption();
              }}
            />
            <button type="button" onClick={addOption}>
              <IconPlus size={15} />
            </button>
          </div>
        </>
      )}

      {field && field.name !== TITLE_FIELD && (
        <>
          <div className={classes.propertySeparator} />
          <button
            type="button"
            className={classes.propertyMenuItem}
            onClick={() =>
              onCreateField?.({
                type: "text",
                position: "left",
                anchorFieldName: field.name,
              })
            }
          >
            <IconArrowBarToLeft size={20} />
            {t("Insert left")}
          </button>
          <button
            type="button"
            className={classes.propertyMenuItem}
            onClick={() =>
              onCreateField?.({
                type: "text",
                position: "right",
                anchorFieldName: field.name,
              })
            }
          >
            <IconArrowBarToRight size={20} />
            {t("Insert right")}
          </button>
        </>
      )}
    </div>
  );
}

function PeoplePicker({
  value,
  users,
  canEdit,
  placeholder = "Select people",
  onSearch,
  onChange,
}: {
  value: unknown;
  users: PeopleOption[];
  canEdit: boolean;
  placeholder?: string;
  onSearch: (query: string) => void;
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const selectedIds = valueAsStringArray(value);
  const [query, setQuery] = useState("");

  const visibleUsers = users.filter((user) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [user.label, user.email ?? ""].some((item) =>
      item.toLowerCase().includes(normalizedQuery),
    );
  });

  const selectedUsers = selectedIds.map((id) => {
    const user = users.find((item) => item.value === id);
    return user ?? { value: id, label: id };
  });

  const toggleUser = (id: string) => {
    if (!canEdit) return;
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    onChange([...selectedIds, id]);
  };

  return (
    <Popover
      width={280}
      shadow="md"
      position="bottom-start"
      disabled={!canEdit}
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.peopleTarget}
          disabled={!canEdit}
        >
          {selectedUsers.length > 0 ? (
            <span className={classes.peopleChips}>
              {selectedUsers.map((user) => (
                <span key={user.value} className={classes.assigneeChip}>
                  <CustomAvatar
                    size={18}
                    name={user.label}
                    avatarUrl={user.avatarUrl ?? undefined}
                  />
                  <span>{user.label}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className={classes.cellEmpty}>{t(placeholder)}</span>
          )}
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className={classes.notionPopover}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className={classes.popoverSearch}>
          <IconSearch size={15} />
          <input
            value={query}
            placeholder={t("Search people...")}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              onSearch(event.currentTarget.value);
            }}
            autoFocus
          />
        </label>
        <div className={classes.popoverList}>
          {visibleUsers.map((user) => {
            const selected = selectedIds.includes(user.value);
            return (
              <button
                key={user.value}
                type="button"
                className={classes.personOption}
                onClick={() => toggleUser(user.value)}
              >
                <CustomAvatar
                  size={22}
                  name={user.label}
                  avatarUrl={user.avatarUrl ?? undefined}
                />
                <span>
                  <strong>{user.label}</strong>
                  {user.email && <em>{user.email}</em>}
                </span>
                {selected && (
                  <IconCheck size={16} className={classes.optionCheck} />
                )}
              </button>
            );
          })}
          {visibleUsers.length === 0 && (
            <div className={classes.popoverEmpty}>{t("No options")}</div>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

function SelectValuePicker({
  value,
  options,
  multiple = false,
  canEdit,
  placeholder = "Empty",
  clearable = true,
  onChange,
}: {
  value: unknown;
  options: string[];
  multiple?: boolean;
  canEdit: boolean;
  placeholder?: string;
  clearable?: boolean;
  onChange: (value: string | string[] | null) => void;
}) {
  const { t } = useTranslation();
  const selectedValues = multiple
    ? valueAsStringArray(value)
    : valueAsString(value)
      ? [valueAsString(value)]
      : [];

  const toggleOption = (option: string) => {
    if (!canEdit) return;
    if (!multiple) {
      onChange(option);
      return;
    }
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter((item) => item !== option));
      return;
    }
    onChange([...selectedValues, option]);
  };

  return (
    <Popover
      width={240}
      shadow="md"
      position="bottom-start"
      disabled={!canEdit}
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.selectTarget}
          disabled={!canEdit}
        >
          {selectedValues.length > 0 ? (
            <span className={classes.optionPillGroup}>
              {selectedValues.map((option, index) => (
                <span
                  key={option}
                  className={classes.optionPill}
                  data-tone={optionTone(option, index)}
                >
                  <span className={classes.optionDot} />
                  {t(option)}
                </span>
              ))}
            </span>
          ) : (
            <span className={classes.cellEmpty}>{t(placeholder)}</span>
          )}
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className={classes.notionPopover}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={classes.popoverList}>
          {clearable && (
            <button
              type="button"
              className={classes.popoverListItem}
              onClick={() => onChange(multiple ? [] : null)}
            >
              <span className={classes.optionPill} data-tone="gray">
                {t("Empty")}
              </span>
            </button>
          )}
          {options.map((option, index) => {
            const selected = selectedValues.includes(option);
            return (
              <button
                key={option}
                type="button"
                className={classes.popoverListItem}
                onClick={() => toggleOption(option)}
              >
                <span
                  className={classes.optionPill}
                  data-tone={optionTone(option, index)}
                >
                  <span className={classes.optionDot} />
                  {t(option)}
                </span>
                {selected && (
                  <IconCheck size={16} className={classes.optionCheck} />
                )}
              </button>
            );
          })}
          {options.length === 0 && (
            <div className={classes.popoverEmpty}>{t("No options")}</div>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

function DateCell({
  value,
  canEdit,
  onChange,
}: {
  value: unknown;
  canEdit: boolean;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const currentValue = datePickerValue(value);

  return (
    <Popover
      width={320}
      shadow="md"
      position="bottom-start"
      disabled={!canEdit}
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          className={classes.dateTarget}
          disabled={!canEdit}
        >
          {currentValue ? (
            <>
              <IconCalendar size={15} />
              <span>{currentValue}</span>
            </>
          ) : (
            <span className={classes.cellEmpty}>{t("Empty")}</span>
          )}
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className={classes.datePopover}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={classes.dateInputRow}>
          <IconCalendar size={16} />
          <input
            readOnly
            value={currentValue || ""}
            placeholder={t("Select date")}
          />
        </div>
        <DatePicker
          value={currentValue}
          onChange={(nextValue) => onChange(datePickerToStorage(nextValue))}
        />
        <div className={classes.dateSettings}>
          <div className={classes.dateSettingRow}>
            <span>{t("End date")}</span>
            <Switch size="xs" />
          </div>
          <button type="button" className={classes.dateSettingRow}>
            <span>{t("Date format")}</span>
            <em>{t("Full date")}</em>
          </button>
          <div className={classes.dateSettingRow}>
            <span>{t("Include time")}</span>
            <Switch size="xs" />
          </div>
          <button type="button" className={classes.dateSettingRow}>
            <span>{t("Remind")}</span>
            <em>{t("None")}</em>
          </button>
          <button
            type="button"
            className={classes.dateClearButton}
            onClick={() => onChange(null)}
          >
            {t("Clear")}
          </button>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

function EditableTableCell({
  record,
  field,
  statuses,
  statusFieldName,
  users,
  canEdit,
  databaseId,
  isDropTarget,
  onOpen,
  onOpenFullPage,
  onCreate,
  onAssigneeSearch,
  onDragOverRecord,
  onClearDropTarget,
  onRowDragStart,
  onDropRecord,
  onAttachPage,
  onUpdate,
}: {
  record: DatabaseRecord;
  field: DatabaseFieldDefinition;
  statuses: string[];
  statusFieldName: string;
  users: PeopleOption[];
  canEdit: boolean;
  databaseId?: string;
  isDropTarget: boolean;
  onOpen: (record: DatabaseRecord) => void;
  onOpenFullPage: (record: DatabaseRecord) => void;
  onCreate: (fields?: Record<string, unknown>) => void;
  onAssigneeSearch: (query: string) => void;
  onDragOverRecord: () => void;
  onClearDropTarget: () => void;
  onRowDragStart: (event: ReactDragEvent<HTMLElement>) => void;
  onDropRecord: (recordId: string) => void;
  onAttachPage: (payload: DragPagePayload | null) => void;
  onUpdate: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const rawValue =
    field.name === TITLE_FIELD ? record.title : record.fields[field.name];
  const [draft, setDraft] = useState(renderCell(rawValue));

  useEffect(() => {
    setDraft(renderCell(rawValue));
  }, [rawValue]);

  const dragProps = canEdit
    ? {
        draggable: true,
        onDragStart: (event: ReactDragEvent<HTMLElement>) => {
          if (shouldSkipRecordDrag(event.target)) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          setRecordDragData(event.dataTransfer, record, databaseId);
        },
        onDragEnd: () => {
          clearDocmostDragPayloads();
          onClearDropTarget();
        },
        onDragOver: (event: ReactDragEvent<HTMLElement>) => {
          if (!hasDocmostDatabaseDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          onDragOverRecord();
        },
        onDrop: (event: ReactDragEvent<HTMLElement>) => {
          if (!hasDocmostDatabaseDrag(event.dataTransfer)) return;
          const recordId = getDraggedRecordId(event.dataTransfer);
          const pagePayload = pagePayloadFromDrag(event.dataTransfer);
          if (!recordId && !pagePayload) return;
          event.preventDefault();
          event.stopPropagation();
          onClearDropTarget();
          if (
            recordId &&
            isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
          ) {
            onDropRecord(recordId);
            return;
          }
          if (pagePayload) onAttachPage(pagePayload);
        },
      }
    : {};

  const commit = () => {
    if (!canEdit) return;
    if (field.type === "number") {
      onUpdate(draft.trim() ? Number(draft) : null);
      return;
    }
    if (field.type === "multiSelect") {
      onUpdate(
        draft
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      return;
    }
    onUpdate(draft);
  };

  if (field.name === TITLE_FIELD) {
    return (
      <div
        className={clsx(
          classes.tableCell,
          isDropTarget && classes.tableCellRowDrop,
        )}
        role="cell"
        {...dragProps}
      >
        <div className={classes.rowOverlayControls}>
          {canEdit && (
            <button
              type="button"
              data-no-row-drag
              className={classes.rowPlusButton}
              aria-label={t("New page")}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCreate();
              }}
            >
              <IconPlus size={16} />
            </button>
          )}
          {canEdit && (
            <Tooltip
              label={
                <>
                  <div>{t("Drag to move")}</div>
                  <div>{t("Click or Cmd+/ to open menu")}</div>
                </>
              }
              withArrow
              openDelay={250}
            >
              <button
                type="button"
                className={classes.rowGripButton}
                aria-label={t("Drag to move")}
                draggable
                onDragStart={onRowDragStart}
                onDragEnd={clearDocmostDragPayloads}
              >
                <IconGripVertical size={18} />
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            data-no-row-drag
            className={classes.rowSelectButton}
            aria-label={t("Select row")}
          >
            <IconCheck size={15} />
          </button>
        </div>
        <IconFileText size={18} className={classes.pageIcon} />
        <input
          className={classes.cellInput}
          value={draft}
          placeholder={t("Type a name...")}
          disabled={!canEdit}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          data-no-row-drag
          className={classes.inlineOpenButton}
          onClick={() => onOpen(record)}
        >
          <IconArrowsMaximize size={13} />
          {t("Open page")}
        </button>
        <Tooltip label={t("Open full page")} withArrow openDelay={250}>
          <button
            type="button"
            data-no-row-drag
            className={classes.inlineFullPageButton}
            onClick={() => onOpenFullPage(record)}
          >
            <IconArrowBarToRight size={13} />
          </button>
        </Tooltip>
      </div>
    );
  }

  if (
    field.name === "Assignee" ||
    field.type === "user" ||
    field.type === "person"
  ) {
    return (
      <div
        className={clsx(
          classes.tableCell,
          isDropTarget && classes.tableCellRowDrop,
        )}
        role="cell"
        {...dragProps}
      >
        <PeoplePicker
          value={valueAsStringArray(rawValue)}
          users={users}
          canEdit={canEdit}
          placeholder="Select people"
          onSearch={onAssigneeSearch}
          onChange={onUpdate}
        />
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label
        className={clsx(
          classes.tableCell,
          isDropTarget && classes.tableCellRowDrop,
        )}
        role="cell"
        {...dragProps}
      >
        <input
          type="checkbox"
          checked={Boolean(rawValue)}
          disabled={!canEdit}
          onChange={(event) => onUpdate(event.currentTarget.checked)}
        />
      </label>
    );
  }

  if (field.type === "multiSelect") {
    return (
      <div
        className={clsx(
          classes.tableCell,
          isDropTarget && classes.tableCellRowDrop,
        )}
        role="cell"
        {...dragProps}
      >
        <SelectValuePicker
          value={rawValue}
          options={field.options ?? []}
          multiple
          canEdit={canEdit}
          onChange={onUpdate}
        />
      </div>
    );
  }

  if (isSelectField(field)) {
    const options =
      field.name === statusFieldName ? statuses : (field.options ?? []);
    return (
      <div
        className={clsx(
          classes.tableCell,
          isDropTarget && classes.tableCellRowDrop,
        )}
        role="cell"
        {...dragProps}
      >
        <SelectValuePicker
          value={rawValue}
          options={options}
          canEdit={canEdit}
          clearable={field.name !== statusFieldName}
          onChange={onUpdate}
        />
      </div>
    );
  }

  if (field.type === "date") {
    return (
      <div
        className={clsx(
          classes.tableCell,
          isDropTarget && classes.tableCellRowDrop,
        )}
        role="cell"
        {...dragProps}
      >
        <DateCell value={rawValue} canEdit={canEdit} onChange={onUpdate} />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        classes.tableCell,
        isDropTarget && classes.tableCellRowDrop,
      )}
      role="cell"
      {...dragProps}
    >
      <input
        className={classes.cellInput}
        value={draft}
        placeholder={fieldTypeLabel(field.type, t)}
        disabled={!canEdit}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}

function GalleryView({
  records,
  canEdit,
  databaseId,
  onOpen,
  onAttachPage,
  onReorderRecord,
}: {
  records: DatabaseRecord[];
  canEdit: boolean;
  databaseId?: string;
  onOpen: (record: DatabaseRecord) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onReorderRecord: (recordId: string, beforeRecordId?: string) => void;
}) {
  const { t } = useTranslation();

  const handleDropAtEnd = (event: ReactDragEvent<HTMLElement>) => {
    if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const recordId = getDraggedRecordId(event.dataTransfer);
    const pagePayload = pagePayloadFromDrag(event.dataTransfer);
    if (
      recordId &&
      isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
    ) {
      onReorderRecord(recordId);
      return;
    }
    if (pagePayload) onAttachPage(pagePayload);
  };

  return (
    <div
      data-database-drop-zone="true"
      className={classes.gallery}
      onDragOver={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={handleDropAtEnd}
    >
      {records.length === 0 ? (
        <div className={clsx(classes.empty, classes.emptyWide)}>
          <Text size="sm" c="dimmed">
            {t("No records yet.")}
          </Text>
        </div>
      ) : (
        records.map((record) => (
          <div
            key={record.id}
            role="button"
            tabIndex={0}
            className={classes.galleryCard}
            draggable={isRecordEditable(canEdit, record)}
            onClick={() => onOpen(record)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(record);
            }}
            onDragStart={(event) => {
              if (
                !isRecordEditable(canEdit, record) ||
                shouldSkipRecordDrag(event.target)
              ) {
                event.preventDefault();
                return;
              }
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              setRecordDragData(event.dataTransfer, record, databaseId);
            }}
            onDragOver={(event) => {
              if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer))
                return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              if (!canEdit) return;
              const recordId = getDraggedRecordId(event.dataTransfer);
              const pagePayload = pagePayloadFromDrag(event.dataTransfer);
              if (!recordId && !pagePayload) return;
              event.preventDefault();
              event.stopPropagation();
              if (
                recordId &&
                isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
              ) {
                if (recordId !== record.id)
                  onReorderRecord(recordId, record.id);
                return;
              }
              if (pagePayload) onAttachPage(pagePayload);
            }}
          >
            <IconFileText size={18} />
            <Text fw={600}>{record.title || t("Untitled")}</Text>
            <Text size="sm" c="dimmed" lineClamp={3}>
              {record.description || t("Empty")}
            </Text>
          </div>
        ))
      )}
    </div>
  );
}

function CalendarView({
  records,
  canEdit,
  databaseId,
  onOpen,
  onAttachPage,
  onReorderRecord,
  onUpdateRecord,
}: {
  records: DatabaseRecord[];
  canEdit: boolean;
  databaseId?: string;
  onOpen: (record: DatabaseRecord) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onReorderRecord: (recordId: string, beforeRecordId?: string) => void;
  onUpdateRecord: (recordId: string, fields: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const firstDate = records.find((record) => record.dueDate)?.dueDate;
  const referenceDate = firstDate
    ? new Date(`${firstDate}T00:00:00`)
    : new Date();
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const monthLabel = firstOfMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - startOffset + 1);
    return {
      date,
      key: datePickerToStorage(date) || "",
      isCurrentMonth: date.getMonth() === month,
    };
  });
  const recordsByDate = records.reduce<Record<string, DatabaseRecord[]>>(
    (result, record) => {
      if (!record.dueDate) return result;
      result[record.dueDate] = [...(result[record.dueDate] ?? []), record];
      return result;
    },
    {},
  );

  const handleDropOnDate = (
    event: ReactDragEvent<HTMLElement>,
    dateKey: string,
  ) => {
    if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const recordId = getDraggedRecordId(event.dataTransfer);
    const pagePayload = pagePayloadFromDrag(event.dataTransfer);
    if (
      recordId &&
      isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
    ) {
      onUpdateRecord(recordId, { "Due date": dateKey });
      onReorderRecord(recordId);
      return;
    }
    if (pagePayload) onAttachPage(pagePayload, { "Due date": dateKey });
  };

  return (
    <div data-database-drop-zone="true" className={classes.calendarView}>
      <div className={classes.calendarTitle}>{monthLabel}</div>
      <div className={classes.calendarGrid}>
        {weekDays.map((day) => (
          <div key={day} className={classes.calendarWeekday}>
            {t(day)}
          </div>
        ))}
        {days.map(({ date, key, isCurrentMonth }) => (
          <div
            key={key}
            data-database-drop-zone="true"
            className={clsx(
              classes.calendarCell,
              !isCurrentMonth && classes.calendarCellMuted,
            )}
            onDragOver={(event) => {
              if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer))
                return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => handleDropOnDate(event, key)}
          >
            <div className={classes.calendarCellHeader}>{date.getDate()}</div>
            {(recordsByDate[key] ?? []).map((record, index) => (
              <button
                key={record.id}
                type="button"
                className={classes.calendarRecord}
                draggable={isRecordEditable(canEdit, record)}
                data-tone={optionTone(record.status, index)}
                onClick={() => onOpen(record)}
                onDragStart={(event) => {
                  if (
                    !isRecordEditable(canEdit, record) ||
                    shouldSkipRecordDrag(event.target)
                  ) {
                    event.preventDefault();
                    return;
                  }
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  setRecordDragData(event.dataTransfer, record, databaseId);
                }}
              >
                {record.title || t("Untitled")}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListView({
  records,
  canEdit,
  databaseId,
  onOpen,
  onOpenFullPage,
  onAttachPage,
  onReorderRecord,
}: {
  records: DatabaseRecord[];
  canEdit: boolean;
  databaseId?: string;
  onOpen: (record: DatabaseRecord) => void;
  onOpenFullPage: (record: DatabaseRecord) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onReorderRecord: (recordId: string, beforeRecordId?: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-database-drop-zone="true"
      className={classes.listView}
      onDragOver={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const recordId = getDraggedRecordId(event.dataTransfer);
        const pagePayload = pagePayloadFromDrag(event.dataTransfer);
        if (
          recordId &&
          isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
        ) {
          onReorderRecord(recordId);
          return;
        }
        if (pagePayload) onAttachPage(pagePayload);
      }}
    >
      {records.map((record) => (
        <div
          key={record.id}
          className={classes.listItem}
          draggable={isRecordEditable(canEdit, record)}
          onDragStart={(event) => {
            if (
              !isRecordEditable(canEdit, record) ||
              shouldSkipRecordDrag(event.target)
            ) {
              event.preventDefault();
              return;
            }
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            setRecordDragData(event.dataTransfer, record, databaseId);
          }}
          onDragOver={(event) => {
            if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            if (!canEdit) return;
            const recordId = getDraggedRecordId(event.dataTransfer);
            const pagePayload = pagePayloadFromDrag(event.dataTransfer);
            if (!recordId && !pagePayload) return;
            event.preventDefault();
            event.stopPropagation();
            if (
              recordId &&
              isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
            ) {
              if (recordId !== record.id) onReorderRecord(recordId, record.id);
              return;
            }
            if (pagePayload) onAttachPage(pagePayload);
          }}
        >
          <IconFileText size={17} className={classes.pageIcon} />
          <button
            type="button"
            data-no-row-drag
            className={classes.listTitle}
            onClick={() => onOpen(record)}
          >
            {record.title || t("Untitled")}
          </button>
          {record.status && (
            <span
              className={classes.optionPill}
              data-tone={optionTone(record.status)}
            >
              {t(record.status)}
            </span>
          )}
          {record.dueDate && (
            <span className={classes.listMeta}>{record.dueDate}</span>
          )}
          <button
            type="button"
            data-no-row-drag
            className={classes.inlineOpenButton}
            onClick={() => onOpenFullPage(record)}
          >
            <IconArrowsMaximize size={13} />
            {t("Open full page")}
          </button>
        </div>
      ))}
      {records.length === 0 && (
        <div className={classes.empty}>
          <Text size="sm" c="dimmed">
            {t("No records yet.")}
          </Text>
        </div>
      )}
    </div>
  );
}

function TimelineView({
  records,
  canEdit,
  databaseId,
  onOpen,
  onAttachPage,
  onReorderRecord,
  onUpdateRecord,
}: {
  records: DatabaseRecord[];
  canEdit: boolean;
  databaseId?: string;
  onOpen: (record: DatabaseRecord) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onReorderRecord: (recordId: string, beforeRecordId?: string) => void;
  onUpdateRecord: (recordId: string, fields: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const visibleRecords = records.filter((record) => record.dueDate).length
    ? records.filter((record) => record.dueDate)
    : records;
  const referenceDate = visibleRecords.find((record) => record.dueDate)?.dueDate
    ? new Date(
        `${visibleRecords.find((record) => record.dueDate)?.dueDate}T00:00:00`,
      )
    : new Date();
  const months = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + index,
      1,
    );
    return {
      label: date.toLocaleDateString(undefined, { month: "short" }),
      dateKey: datePickerToStorage(date) || "",
    };
  });

  return (
    <div
      data-database-drop-zone="true"
      className={classes.timelineView}
      onDragOver={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const recordId = getDraggedRecordId(event.dataTransfer);
        const pagePayload = pagePayloadFromDrag(event.dataTransfer);
        if (
          recordId &&
          isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
        ) {
          onReorderRecord(recordId);
          return;
        }
        if (pagePayload) onAttachPage(pagePayload);
      }}
    >
      <div className={classes.timelineGrid}>
        <div className={classes.timelineRowsHeader}>{t("Name")}</div>
        <div className={classes.timelineMonths}>
          {months.map((month) => (
            <span
              key={month.dateKey}
              onDragOver={(event) => {
                if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer))
                  return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={(event) => {
                if (!canEdit) return;
                event.preventDefault();
                event.stopPropagation();
                const recordId = getDraggedRecordId(event.dataTransfer);
                const pagePayload = pagePayloadFromDrag(event.dataTransfer);
                if (
                  recordId &&
                  isSameDatabaseDrag(
                    pagePayload,
                    databaseId,
                    event.dataTransfer,
                  )
                ) {
                  onUpdateRecord(recordId, { "Due date": month.dateKey });
                  onReorderRecord(recordId);
                  return;
                }
                if (pagePayload)
                  onAttachPage(pagePayload, { "Due date": month.dateKey });
              }}
            >
              {month.label}
            </span>
          ))}
        </div>
        {visibleRecords.map((record, index) => {
          const startColumn = record.dueDate
            ? Math.min(
                5,
                Math.max(
                  1,
                  ((new Date(`${record.dueDate}T00:00:00`).getMonth() -
                    referenceDate.getMonth() +
                    12) %
                    12) +
                    1,
                ),
              )
            : (index % 4) + 1;
          const span = Math.min(2, 1 + (index % 2));
          return (
            <div
              key={record.id}
              role="button"
              tabIndex={0}
              className={classes.timelineRow}
              draggable={isRecordEditable(canEdit, record)}
              onClick={() => onOpen(record)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onOpen(record);
              }}
              onDragStart={(event) => {
                if (
                  !isRecordEditable(canEdit, record) ||
                  shouldSkipRecordDrag(event.target)
                ) {
                  event.preventDefault();
                  return;
                }
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                setRecordDragData(event.dataTransfer, record, databaseId);
              }}
              onDragOver={(event) => {
                if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer))
                  return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={(event) => {
                if (!canEdit) return;
                const recordId = getDraggedRecordId(event.dataTransfer);
                const pagePayload = pagePayloadFromDrag(event.dataTransfer);
                if (!recordId && !pagePayload) return;
                event.preventDefault();
                event.stopPropagation();
                if (
                  recordId &&
                  isSameDatabaseDrag(
                    pagePayload,
                    databaseId,
                    event.dataTransfer,
                  )
                ) {
                  if (recordId !== record.id)
                    onReorderRecord(recordId, record.id);
                  return;
                }
                if (pagePayload)
                  onAttachPage(pagePayload, { "Due date": record.dueDate });
              }}
            >
              <span className={classes.timelineName}>
                <IconFileText size={15} />
                {record.title || t("Untitled")}
              </span>
              <span className={classes.timelineTrack}>
                <span
                  className={classes.timelineBar}
                  data-tone={optionTone(record.status, index)}
                  style={{ gridColumn: `${startColumn} / span ${span}` }}
                >
                  {record.title || t("Untitled")}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SecondaryView({
  type,
  records,
  canEdit,
  databaseId,
  onOpen,
  onCreate,
  onAttachPage,
  onReorderRecord,
}: {
  type: DatabaseViewType;
  records: DatabaseRecord[];
  canEdit: boolean;
  databaseId?: string;
  onOpen: (record: DatabaseRecord) => void;
  onCreate: (fields?: Record<string, unknown>) => void;
  onAttachPage: (
    payload: DragPagePayload | null,
    fields?: Record<string, unknown>,
  ) => void;
  onReorderRecord: (recordId: string, beforeRecordId?: string) => void;
}) {
  const { t } = useTranslation();
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const statusCounts = records.reduce<Record<string, number>>(
    (result, record) => {
      const key = record.status || "Empty";
      result[key] = (result[key] ?? 0) + 1;
      return result;
    },
    {},
  );
  const statusEntries = Object.entries(statusCounts);

  const handleDropAtEnd = (event: ReactDragEvent<HTMLElement>) => {
    if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const recordId = getDraggedRecordId(event.dataTransfer);
    const pagePayload = pagePayloadFromDrag(event.dataTransfer);
    if (
      recordId &&
      isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
    ) {
      onReorderRecord(recordId);
      return;
    }
    if (pagePayload) onAttachPage(pagePayload);
  };

  if (type === "chart" || type === "dashboard") {
    const doneCount = records.filter(
      (record) => record.status === "Done",
    ).length;
    return (
      <div
        data-database-drop-zone="true"
        className={classes.dashboardView}
        onDragOver={(event) => {
          if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={handleDropAtEnd}
      >
        <div className={classes.metricCard}>
          <span>{t("Total records")}</span>
          <strong>{records.length}</strong>
        </div>
        <div className={classes.metricCard}>
          <span>{t("Done")}</span>
          <strong>{doneCount}</strong>
        </div>
        <div className={classes.chartCard}>
          {statusEntries.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t("No records yet.")}
            </Text>
          ) : (
            statusEntries.map(([status, count], index) => (
              <span
                key={status}
                style={{ height: `${Math.max(28, count * 34)}px` }}
                data-tone={optionTone(status, index)}
                title={`${t(status)}: ${count}`}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  if (type === "form") {
    return (
      <div
        data-database-drop-zone="true"
        className={classes.formView}
        onDragOver={(event) => {
          if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={handleDropAtEnd}
      >
        <div className={classes.formPreview}>
          <Text fw={750} size="xl">
            {t("Collect form")}
          </Text>
          <Text size="sm" c="dimmed">
            {t("Create new pages from a simple form.")}
          </Text>
          <TextInput
            mt="md"
            label={t("Name")}
            placeholder={t("Type a name...")}
            value={formTitle}
            onChange={(event) => setFormTitle(event.currentTarget.value)}
          />
          <TextInput
            mt="sm"
            label={t("Description")}
            placeholder={t("Empty")}
            value={formDescription}
            onChange={(event) => setFormDescription(event.currentTarget.value)}
          />
          {canEdit && (
            <Button
              mt="md"
              className={classes.newButton}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                onCreate({ Title: formTitle, Description: formDescription });
                setFormTitle("");
                setFormDescription("");
              }}
            >
              {t("Submit")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-database-drop-zone="true"
      className={classes.listView}
      onDragOver={(event) => {
        if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={handleDropAtEnd}
    >
      {records.map((record) => (
        <div
          key={record.id}
          role="button"
          tabIndex={0}
          className={classes.feedItem}
          draggable={isRecordEditable(canEdit, record)}
          onClick={() => onOpen(record)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onOpen(record);
          }}
          onDragStart={(event) => {
            if (
              !isRecordEditable(canEdit, record) ||
              shouldSkipRecordDrag(event.target)
            ) {
              event.preventDefault();
              return;
            }
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            setRecordDragData(event.dataTransfer, record, databaseId);
          }}
          onDragOver={(event) => {
            if (!canEdit || !hasDocmostDatabaseDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            if (!canEdit) return;
            const recordId = getDraggedRecordId(event.dataTransfer);
            const pagePayload = pagePayloadFromDrag(event.dataTransfer);
            if (!recordId && !pagePayload) return;
            event.preventDefault();
            event.stopPropagation();
            if (
              recordId &&
              isSameDatabaseDrag(pagePayload, databaseId, event.dataTransfer)
            ) {
              if (recordId !== record.id) onReorderRecord(recordId, record.id);
              return;
            }
            if (pagePayload) onAttachPage(pagePayload);
          }}
        >
          <ViewIcon type={type} />
          <span>{record.title || t("Untitled")}</span>
          <em>
            {type === "feed"
              ? record.status || t("Updated")
              : type === "map"
                ? valueAsString(
                    record.fields.Place || record.fields.Location,
                  ) || t("No location")
                : t(viewNameForType(type))}
          </em>
        </div>
      ))}
      {records.length === 0 && (
        <div className={classes.empty}>
          <Text size="sm" c="dimmed">
            {t("No records yet.")}
          </Text>
        </div>
      )}
    </div>
  );
}

function RecordSidePage({
  opened,
  record,
  fields,
  statuses,
  statusFieldName,
  users,
  canEdit,
  canEditSchema,
  onClose,
  onOpenFullPage,
  onAssigneeSearch,
  onUpdate,
  onCreateField,
  onUpdateField,
}: {
  opened: boolean;
  record: DatabaseRecord | null;
  fields: DatabaseFieldDefinition[];
  statuses: string[];
  statusFieldName: string;
  users: PeopleOption[];
  canEdit: boolean;
  canEditSchema: boolean;
  onClose: () => void;
  onOpenFullPage: () => void;
  onAssigneeSearch: (query: string) => void;
  onUpdate: (recordId: string, fields: Record<string, unknown>) => void;
  onCreateField: (input: CreateFieldInput) => void;
  onUpdateField: (input: UpdateFieldInput) => void;
}) {
  const { t } = useTranslation();
  const [draftFields, setDraftFields] = useState<Record<string, unknown>>({});
  const [recordEditor, setRecordEditor] = useState<Editor | null>(null);
  const recordPageQuery = usePageQuery({
    pageId: opened ? record?.pageId : undefined,
  });
  const recordPage = recordPageQuery.data;

  useEffect(() => {
    setRecordEditor(null);
    setDraftFields(
      record
        ? {
            ...record.fields,
            Title: record.fields.Title ?? record.pageTitle ?? record.title,
            Status: record.fields.Status ?? record.status,
            Assignee: record.fields.Assignee ?? record.assigneeIds,
            "Due date": record.fields["Due date"] ?? record.dueDate,
            Priority: record.fields.Priority ?? record.priority,
            Tags: record.fields.Tags ?? record.tags,
          }
        : {},
    );
  }, [record?.fields, record?.id, record?.pageTitle, record?.title]);

  if (!record || !opened) return null;

  const updateDraftField = (field: string, value: unknown) => {
    setDraftFields((draft) => ({ ...draft, [field]: value }));
  };

  const commitField = (field: string, value: unknown) => {
    updateDraftField(field, value);
    onUpdate(record.id, { [field]: value });
  };

  return createPortal(
    <div
      className={classes.recordPageOverlay}
      data-record-side-page="overlay"
      onMouseDown={onClose}
    >
      <aside
        className={classes.recordPage}
        data-record-side-page="panel"
        onMouseDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.stopPropagation()}
        onDragOver={(event) => event.stopPropagation()}
        onDrop={(event) => event.stopPropagation()}
        onDragEnd={(event) => event.stopPropagation()}
      >
        <div className={classes.recordPageTopbar}>
          <Group gap={4}>
            <Tooltip label={t("Close")} withArrow openDelay={250}>
              <ActionIcon
                variant="subtle"
                color="dark"
                aria-label={t("Close")}
                onClick={onClose}
              >
                <IconX size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Open full page")} withArrow openDelay={250}>
              <ActionIcon
                variant="subtle"
                color="dark"
                aria-label={t("Open full page")}
                onClick={onOpenFullPage}
              >
                <IconArrowsMaximize size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group gap={4}>
            <PageShareModal
              pageId={recordPage?.id ?? record.pageId}
              readOnly={!canEdit}
            />
            <PageActionMenu
              pageId={recordPage?.id ?? record.pageId}
              readOnly={!canEdit}
              getEditorHTML={() => recordEditor?.getHTML()}
              onDeleted={onClose}
            />
          </Group>
        </div>

        <div className={classes.recordPageContent}>
          <input
            className={classes.recordTitleInput}
            value={valueAsString(draftFields.Title)}
            placeholder={t("Untitled")}
            disabled={!canEdit}
            onChange={(event) =>
              updateDraftField("Title", event.currentTarget.value)
            }
            onBlur={(event) =>
              onUpdate(record.id, { Title: event.currentTarget.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />

          <div className={classes.propertyList}>
            {fields
              .filter((field) => field.name !== TITLE_FIELD)
              .map((field) => (
                <RecordPropertyRow
                  key={field.name}
                  field={field}
                  value={draftFields[field.name]}
                  statuses={statuses}
                  statusFieldName={statusFieldName}
                  users={users}
                  canEdit={canEdit}
                  onAssigneeSearch={onAssigneeSearch}
                  onUpdate={(value) => commitField(field.name, value)}
                />
              ))}
            {canEditSchema && (
              <Popover
                width={520}
                shadow="md"
                position="bottom-start"
                withinPortal
              >
                <Popover.Target>
                  <button type="button" className={classes.addPropertyRow}>
                    <IconPlus size={16} />
                    {t("Add a property")}
                  </button>
                </Popover.Target>
                <Popover.Dropdown className={classes.propertyPopover}>
                  <PropertyEditor
                    onCreateField={onCreateField}
                    onUpdateField={onUpdateField}
                  />
                </Popover.Dropdown>
              </Popover>
            )}
          </div>

          <div className={classes.recordNativePage}>
            {recordPageQuery.isLoading ? (
              <Group justify="center" p="md">
                <Loader size="sm" />
              </Group>
            ) : recordPage ? (
              <EmbeddedRecordPageEditor
                key={recordPage.id}
                pageId={recordPage.id}
                slugId={recordPage.slugId}
                editable={canEdit}
                content={recordPage.content}
                canComment
                onEditorReady={setRecordEditor}
              />
            ) : (
              <Text size="sm" c="dimmed">
                {t("This record page could not be loaded.")}
              </Text>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function RecordPropertyRow({
  field,
  value,
  statuses,
  statusFieldName,
  users,
  canEdit,
  onAssigneeSearch,
  onUpdate,
}: {
  field: DatabaseFieldDefinition;
  value: unknown;
  statuses: string[];
  statusFieldName: string;
  users: PeopleOption[];
  canEdit: boolean;
  onAssigneeSearch: (query: string) => void;
  onUpdate: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const Icon = fieldTypeIcon(field.type);

  return (
    <div className={classes.propertyRow}>
      <div className={classes.propertyRowLabel}>
        <Icon size={17} />
        <span>{fieldLabel(field.name, t)}</span>
      </div>
      <div className={classes.propertyRowValue}>
        {field.name === "Assignee" || field.type === "user" ? (
          <PeoplePicker
            value={valueAsStringArray(value)}
            users={users}
            canEdit={canEdit}
            placeholder="Empty"
            onSearch={onAssigneeSearch}
            onChange={onUpdate}
          />
        ) : isSelectField(field) ? (
          <SelectValuePicker
            value={value}
            options={
              field.name === statusFieldName ? statuses : (field.options ?? [])
            }
            canEdit={canEdit}
            clearable={field.name !== statusFieldName}
            onChange={onUpdate}
          />
        ) : field.type === "date" ? (
          <DateCell value={value} canEdit={canEdit} onChange={onUpdate} />
        ) : field.type === "checkbox" ? (
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={!canEdit}
            onChange={(event) => onUpdate(event.currentTarget.checked)}
          />
        ) : field.type === "multiSelect" ? (
          <SelectValuePicker
            value={value}
            options={field.options ?? []}
            multiple
            canEdit={canEdit}
            onChange={onUpdate}
          />
        ) : (
          <InlinePropertyInput
            value={value}
            canEdit={canEdit}
            onUpdate={onUpdate}
          />
        )}
      </div>
    </div>
  );
}

function InlineMultiPropertyInput({
  value,
  canEdit,
  onUpdate,
}: {
  value: unknown;
  canEdit: boolean;
  onUpdate: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(valueAsStringArray(value).join(", "));

  useEffect(() => {
    setDraft(valueAsStringArray(value).join(", "));
  }, [value]);

  return (
    <TextInput
      value={draft}
      disabled={!canEdit}
      placeholder={t("Empty")}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) =>
        onUpdate(
          event.currentTarget.value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        )
      }
      size="xs"
      variant="unstyled"
    />
  );
}

function InlinePropertyInput({
  value,
  canEdit,
  onUpdate,
}: {
  value: unknown;
  canEdit: boolean;
  onUpdate: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(valueAsString(value));

  useEffect(() => {
    setDraft(valueAsString(value));
  }, [value]);

  return (
    <TextInput
      value={draft}
      disabled={!canEdit}
      placeholder={t("Empty")}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => onUpdate(event.currentTarget.value)}
      size="xs"
      variant="unstyled"
    />
  );
}

function renderCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
