import { describe, expect, it } from "vitest";
import {
  getKanbanGroupField,
  projectRecordFieldsToBoard,
} from "./database-board-fields";
import {
  DatabaseBoardTarget,
  DatabaseRecord,
} from "@/features/database/types/database.types";

describe("database board field mapping", () => {
  it("uses the view group field instead of a hard-coded Status property", () => {
    const fields = [
      { name: "Title", type: "text" as const, isPrimary: true },
      {
        name: "Phase",
        type: "status" as const,
        options: ["Backlog", "Done"],
      },
    ];

    expect(
      getKanbanGroupField(fields, {
        id: "board",
        name: "Board",
        type: "kanban",
        groupBy: "Phase",
      })?.name,
    ).toBe("Phase");
  });

  it("projects a moved record onto the target schema and a valid group", () => {
    const record = {
      id: "record_1",
      title: "Investigate",
      status: "Doing",
      fields: {
        Title: "Investigate",
        Status: "Doing",
        Priority: "High",
        SourceOnly: "discard me",
      },
      assigneeIds: [],
      dueDate: null,
      priority: "High",
      tags: [],
      description: null,
    } satisfies DatabaseRecord;
    const target = {
      id: "database_2",
      activeViewId: "board",
      fields: [
        { name: "Title", type: "text", isPrimary: true },
        {
          name: "Phase",
          type: "status",
          options: ["Backlog", "Done"],
        },
        { name: "Priority", type: "singleSelect", options: ["High"] },
      ],
      views: [
        {
          id: "board",
          name: "Board",
          type: "kanban",
          groupBy: "Phase",
        },
      ],
    } as DatabaseBoardTarget;

    expect(projectRecordFieldsToBoard(record, target)).toEqual({
      Phase: "Backlog",
    });
  });
});
