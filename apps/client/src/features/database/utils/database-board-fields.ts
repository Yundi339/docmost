import {
  DatabaseBoardTarget,
  DatabaseFieldDefinition,
  DatabaseRecord,
  DatabaseViewDefinition,
} from "@/features/database/types/database.types";

export function getKanbanGroupField(
  fields: DatabaseFieldDefinition[],
  view?: DatabaseViewDefinition,
) {
  return (
    fields.find((field) => field.name === view?.groupBy) ??
    fields.find((field) => field.type === "status") ??
    fields.find((field) => ["singleSelect", "select"].includes(field.type))
  );
}

export function projectRecordFieldsToBoard(
  record: DatabaseRecord,
  target: DatabaseBoardTarget,
) {
  const targetFields = target.fields ?? [];
  const targetView =
    target.views.find((view) => view.id === target.activeViewId) ??
    target.views.find((view) => view.type === "kanban");
  const targetGroupField = getKanbanGroupField(targetFields, targetView);
  if (!targetGroupField) return {};

  const options = targetGroupField.options ?? [];
  const targetStatus = options.includes(record.status)
    ? record.status
    : options[0];
  if (targetStatus === undefined) return {};

  return { [targetGroupField.name]: targetStatus };
}
