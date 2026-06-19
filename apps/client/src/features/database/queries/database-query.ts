import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDatabaseField,
  createDatabaseRecord,
  createDatabaseView,
  attachDatabasePage,
  detachDatabaseRecord,
  getDatabaseInfo,
  listDatabaseTargets,
  listDatabaseRecords,
  reorderDatabaseRecord,
  trashDatabaseRecordPage,
  updateDatabaseField,
  updateDatabaseTitle,
  updateDatabaseRecord,
} from "@/features/database/services/database-service";
import {
  DatabaseBlockInfo,
  DatabaseFieldDefinition,
  DatabaseRecord,
} from "@/features/database/types/database.types";

export function useDatabaseInfoQuery(databaseId?: string) {
  return useQuery({
    queryKey: ["database", databaseId],
    queryFn: () => getDatabaseInfo(databaseId!),
    enabled: Boolean(databaseId),
  });
}

export function useDatabaseRecordsQuery(databaseId?: string) {
  return useQuery({
    queryKey: ["database-records", databaseId],
    queryFn: () => listDatabaseRecords(databaseId!),
    enabled: Boolean(databaseId),
  });
}

export function useDatabaseBoardTargetsQuery(excludeDatabaseId?: string) {
  return useQuery({
    queryKey: ["database-targets", excludeDatabaseId],
    queryFn: () => listDatabaseTargets({ excludeDatabaseId }),
    enabled: Boolean(excludeDatabaseId),
  });
}

export function useCreateDatabaseRecordMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: Record<string, unknown>) =>
      createDatabaseRecord({ databaseId: databaseId!, fields }),
    onSuccess: (record) => {
      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", databaseId],
        (records = []) => [...records, record],
      );
    },
  });
}

export function useUpdateDatabaseRecordMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      recordId: string;
      fields: Record<string, unknown>;
    }) => updateDatabaseRecord({ databaseId: databaseId!, ...input }),
    onSuccess: (record) => {
      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", databaseId],
        (records = []) =>
          records.map((item) => (item.id === record.id ? record : item)),
      );
    },
  });
}

export function useReorderDatabaseRecordMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      recordId: string;
      beforeRecordId?: string;
      afterRecordId?: string;
    }) => reorderDatabaseRecord({ databaseId: databaseId!, ...input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ["database-records", databaseId],
      });
      const previousRecords = queryClient.getQueryData<DatabaseRecord[]>([
        "database-records",
        databaseId,
      ]);

      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", databaseId],
        (records = []) =>
          reorderRecords(records, input.recordId, input.beforeRecordId),
      );

      return { previousRecords };
    },
    onError: (_error, _input, context) => {
      if (context?.previousRecords) {
        queryClient.setQueryData(
          ["database-records", databaseId],
          context.previousRecords,
        );
      }
    },
    onSuccess: (record) => {
      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", databaseId],
        (records = []) =>
          records.map((item) => (item.id === record.id ? record : item)),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["database-records", databaseId],
      });
    },
  });
}

export function useAttachDatabasePageMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      pageId: string;
      fields?: Record<string, unknown>;
      sourceDatabaseId?: string;
      sourceRecordId?: string;
    }) => attachDatabasePage({ databaseId: databaseId!, ...input }),
    onSuccess: (record, input) => {
      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", databaseId],
        (records = []) =>
          records.some((item) => item.id === record.id)
            ? records
            : [...records, record],
      );

      if (input.sourceDatabaseId) {
        void queryClient.invalidateQueries({
          queryKey: ["database-records", input.sourceDatabaseId],
        });
      }
    },
  });
}

export function useAttachDatabasePageToDatabaseMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      databaseId: string;
      pageId: string;
      fields?: Record<string, unknown>;
      sourceDatabaseId?: string;
      sourceRecordId?: string;
    }) => attachDatabasePage(input),
    onSuccess: (record, input) => {
      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", input.databaseId],
        (records = []) =>
          records.some((item) => item.id === record.id)
            ? records.map((item) => (item.id === record.id ? record : item))
            : [...records, record],
      );

      if (input.sourceDatabaseId) {
        void queryClient.invalidateQueries({
          queryKey: ["database-records", input.sourceDatabaseId],
        });
      }
    },
  });
}

export function useDetachDatabaseRecordMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      recordId: string;
      targetPageId?: string;
      targetSpaceId?: string;
    }) => detachDatabaseRecord({ databaseId: databaseId!, ...input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ["database-records", databaseId],
      });
      const previousRecords = queryClient.getQueryData<DatabaseRecord[]>([
        "database-records",
        databaseId,
      ]);

      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", databaseId],
        (records = []) =>
          records.filter((record) => record.id !== input.recordId),
      );

      return { previousRecords };
    },
    onError: (_error, _input, context) => {
      if (context?.previousRecords) {
        queryClient.setQueryData(
          ["database-records", databaseId],
          context.previousRecords,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["database-records", databaseId],
      });
    },
  });
}

export function useTrashDatabaseRecordPageMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { recordId: string }) =>
      trashDatabaseRecordPage({ databaseId: databaseId!, ...input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ["database-records", databaseId],
      });
      const previousRecords = queryClient.getQueryData<DatabaseRecord[]>([
        "database-records",
        databaseId,
      ]);

      queryClient.setQueryData<DatabaseRecord[]>(
        ["database-records", databaseId],
        (records = []) =>
          records.filter((record) => record.id !== input.recordId),
      );

      return { previousRecords };
    },
    onError: (_error, _input, context) => {
      if (context?.previousRecords) {
        queryClient.setQueryData(
          ["database-records", databaseId],
          context.previousRecords,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["database-records", databaseId],
      });
      void queryClient.invalidateQueries({
        predicate: (item) =>
          ["trash-list"].includes(item.queryKey[0] as string),
      });
    },
  });
}

function reorderRecords(
  records: DatabaseRecord[],
  recordId: string,
  beforeRecordId?: string,
) {
  const movingRecord = records.find((record) => record.id === recordId);
  if (!movingRecord) return records;

  const nextRecords = records.filter((record) => record.id !== recordId);
  const insertionIndex = beforeRecordId
    ? nextRecords.findIndex((record) => record.id === beforeRecordId)
    : nextRecords.length;

  nextRecords.splice(
    insertionIndex < 0 ? nextRecords.length : insertionIndex,
    0,
    movingRecord,
  );
  return nextRecords;
}

export function useUpdateDatabaseTitleMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      updateDatabaseTitle({ databaseId: databaseId!, title }),
    onSuccess: (database) => {
      queryClient.setQueryData<DatabaseBlockInfo>(
        ["database", databaseId],
        database,
      );
    },
  });
}

export function useCreateDatabaseFieldMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      type: DatabaseFieldDefinition["type"];
      options?: string[];
      position?: "left" | "right" | "end";
      anchorFieldName?: string;
    }) => createDatabaseField({ databaseId: databaseId!, ...input }),
    onSuccess: (database) => {
      queryClient.setQueryData<DatabaseBlockInfo>(
        ["database", databaseId],
        database,
      );
      void queryClient.invalidateQueries({
        queryKey: ["database-records", databaseId],
      });
    },
  });
}

export function useUpdateDatabaseFieldMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      fieldName: string;
      name?: string;
      type?: DatabaseFieldDefinition["type"];
      options?: string[];
    }) => updateDatabaseField({ databaseId: databaseId!, ...input }),
    onSuccess: (database) => {
      queryClient.setQueryData<DatabaseBlockInfo>(
        ["database", databaseId],
        database,
      );
      void queryClient.invalidateQueries({
        queryKey: ["database-records", databaseId],
      });
    },
  });
}

export function useCreateDatabaseViewMutation(databaseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      type: DatabaseBlockInfo["views"][number]["type"];
      groupBy?: string;
    }) => createDatabaseView({ databaseId: databaseId!, ...input }),
    onSuccess: (database) => {
      queryClient.setQueryData<DatabaseBlockInfo>(
        ["database", databaseId],
        database,
      );
    },
  });
}
