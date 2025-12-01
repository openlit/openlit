"use client";

import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { BookOpenText, TrashIcon, PlusIcon, EditIcon } from "lucide-react";
import ConfirmationModal from "@/components/common/confirmation-modal";
import DataTable from "@/components/data-table/table";
import { Columns } from "@/components/data-table/columns";
import { CustomEvaluationConfig } from "@/types/evaluation";
import { Button } from "@/components/ui/button";
import FormBuilder from "@/components/common/form-builder";
import { FormBuilderEvent } from "@/types/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PRIMARY_BACKGROUND } from "@/constants/common-classes";

const columns: Columns<string, CustomEvaluationConfig> = {
  name: {
    header: () => "Name",
    cell: ({ row }) => row.name,
  },
  evaluationType: {
    header: () => "Evaluation Type",
    cell: ({ row }) => row.evaluationType,
  },
  thresholdScore: {
    header: () => "Threshold Score",
    cell: ({ row }) => row.thresholdScore?.toFixed(2) || "N/A",
  },
  enabled: {
    header: () => "Status",
    cell: ({ row }) => (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          row.enabled
            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
        }`}
      >
        {row.enabled ? "Active" : "Inactive"}
      </span>
    ),
  },
  createdBy: {
    header: () => "Created By",
    cell: ({ row }) => row.createdBy,
  },
  createdAt: {
    header: () => "Created At",
    cell: ({ row }) => format(new Date(row.createdAt), "MMM do, y"),
  },
  actions: {
    header: () => "Actions",
    cell: ({ row, extraFunctions }) => {
      return (
        <div className="flex justify-start items-center gap-4">
          <EditIcon
            className="w-4 cursor-pointer"
            onClick={() => extraFunctions?.handleEdit?.(row)}
          />
          <ConfirmationModal
            handleYes={extraFunctions?.handleDelete}
            title="Are you sure you want to delete this custom evaluation?"
            subtitle="Deleting custom evaluations might affect ongoing evaluations. Please confirm before deleting it."
            params={{
              id: row.id,
            }}
          >
            <TrashIcon className="w-4 cursor-pointer" />
          </ConfirmationModal>
        </div>
      );
    },
  },
};

interface CustomEvaluationFormProps {
  evaluation?: CustomEvaluationConfig;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function CustomEvaluationForm({
  evaluation,
  onSubmit,
  onCancel,
  isLoading = false,
}: CustomEvaluationFormProps) {
  const handleSubmit: FormBuilderEvent = useCallback(
    (event) => {
      event.preventDefault();
      const formElement = event.target as HTMLFormElement;

      const payload = {
        name: (formElement.name as any).value,
        description: (formElement.description as any).value,
        evaluationType: (formElement.evaluationType as any).value,
        customPrompt: (formElement.customPrompt as any).value,
        thresholdScore: parseFloat((formElement.thresholdScore as any).value),
        enabled: (formElement.enabled as any).checked,
        meta: {},
      };

      onSubmit(payload);
    },
    [onSubmit]
  );

  return (
    <div className="space-y-6">
      <FormBuilder
        cardClassName={`${PRIMARY_BACKGROUND} py-4 px-6 rounded-lg`}
        fields={[
          {
            label: "Name",
            inputKey: `${evaluation?.id || "new"}-name`,
            fieldType: "INPUT",
            fieldTypeProps: {
              type: "text",
              name: "name",
              placeholder: "PII Detection",
              defaultValue: evaluation?.name || "",
              required: true,
            },
          },
          {
            label: "Description",
            inputKey: `${evaluation?.id || "new"}-description`,
            fieldType: "TEXTAREA",
            fieldTypeProps: {
              name: "description",
              placeholder:
                "Detects personally identifiable information in the content",
              defaultValue: evaluation?.description || "",
              rows: 3,
              required: true,
            },
          },
          {
            label: "Evaluation Type",
            inputKey: `${evaluation?.id || "new"}-evaluationType`,
            fieldType: "INPUT",
            fieldTypeProps: {
              type: "text",
              name: "evaluationType",
              placeholder: "pii_detection",
              defaultValue: evaluation?.evaluationType || "",
              required: true,
            },
          },
          {
            label: "Custom Prompt",
            inputKey: `${evaluation?.id || "new"}-customPrompt`,
            fieldType: "TEXTAREA",
            fieldTypeProps: {
              name: "customPrompt",
              placeholder:
                "Analyze the following content for personally identifiable information...",
              defaultValue: evaluation?.customPrompt || "",
              rows: 8,
              required: true,
            },
          },
          {
            label: "Threshold Score (0.0 - 1.0)",
            inputKey: `${evaluation?.id || "new"}-thresholdScore`,
            fieldType: "INPUT",
            fieldTypeProps: {
              type: "number",
              name: "thresholdScore",
              placeholder: "0.7",
              defaultValue: evaluation?.thresholdScore?.toString() || "0.7",
              min: "0",
              max: "1",
              step: "0.1",
              required: true,
            },
          },
          {
            label: "Enabled",
            inputKey: `${evaluation?.id || "new"}-enabled`,
            fieldType: "SWITCH",
            fieldTypeProps: {
              name: "enabled",
              defaultChecked: evaluation?.enabled ?? true,
            },
          },
        ]}
        heading={`${evaluation ? "Update" : "Create"} Custom Evaluation`}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        submitButtonText={evaluation ? "Update" : "Create"}
      />
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function CustomEvaluations() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvaluation, setEditingEvaluation] = useState<
    CustomEvaluationConfig | undefined
  >();
  const { data, fireRequest, isFetched, isLoading } =
    useFetchWrapper<CustomEvaluationConfig[]>();
  const { fireRequest: fireDeleteRequest, isLoading: isDeleting } =
    useFetchWrapper();
  const { fireRequest: fireCreateRequest, isLoading: isCreating } =
    useFetchWrapper();
  const { fireRequest: fireUpdateRequest, isLoading: isUpdating } =
    useFetchWrapper();

  const pingStatus = useRootStore(getPingStatus);

  const fetchData = useCallback(async () => {
    fireRequest({
      requestType: "GET",
      url: `/api/evaluation/custom-config`,
      responseDataKey: "data",
      successCb: (data: any) => {
        console.log("Custom evaluations data received:", data);
      },
      failureCb: (err?: string) => {
        toast.error(err || `Cannot connect to server!`, {
          id: "custom-evaluations",
        });
      },
    });
  }, [fireRequest]);

  const deleteEvaluation = useCallback(
    async ({ id }: { id: string }) => {
      fireDeleteRequest({
        requestType: "DELETE",
        url: `/api/evaluation/custom-config/${id}`,
        successCb: (data: any) => {
          toast.success("Custom evaluation deleted successfully!", {
            id: "custom-evaluations",
          });
          fetchData();
        },
        failureCb: (err?: string) => {
          toast.error(err || `Failed to delete custom evaluation!`, {
            id: "custom-evaluations",
          });
        },
      });
    },
    [fireDeleteRequest, fetchData]
  );

  const handleEdit = useCallback((evaluation: CustomEvaluationConfig) => {
    setEditingEvaluation(evaluation);
    setIsDialogOpen(true);
  }, []);

  const handleCreate = useCallback(() => {
    setEditingEvaluation(undefined);
    setIsDialogOpen(true);
  }, []);

  const handleFormSubmit = useCallback(
    async (payload: any) => {
      if (editingEvaluation) {
        // Update existing evaluation
        fireUpdateRequest({
          requestType: "PUT",
          url: `/api/evaluation/custom-config/${editingEvaluation.id}`,
          body: JSON.stringify(payload),
          responseDataKey: "data",
          successCb: () => {
            toast.success("Custom evaluation updated successfully!", {
              id: "custom-evaluations",
            });
            setIsDialogOpen(false);
            setEditingEvaluation(undefined);
            fetchData();
          },
          failureCb: (err?: string) => {
            toast.error(err || `Failed to update custom evaluation!`, {
              id: "custom-evaluations",
            });
          },
        });
      } else {
        // Create new evaluation
        fireCreateRequest({
          requestType: "POST",
          url: `/api/evaluation/custom-config`,
          body: JSON.stringify(payload),
          responseDataKey: "data",
          successCb: () => {
            toast.success("Custom evaluation created successfully!", {
              id: "custom-evaluations",
            });
            setIsDialogOpen(false);
            fetchData();
          },
          failureCb: (err?: string) => {
            toast.error(err || `Failed to create custom evaluation!`, {
              id: "custom-evaluations",
            });
          },
        });
      }
    },
    [editingEvaluation, fireCreateRequest, fireUpdateRequest, fetchData]
  );

  const handleFormCancel = useCallback(() => {
    setIsDialogOpen(false);
    setEditingEvaluation(undefined);
  }, []);

  useEffect(() => {
    if (pingStatus !== "pending") {
      fetchData();
    }
  }, [pingStatus, fetchData]);

  return (
    <>
      <div className="flex flex-col h-full w-full p-2">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
              Custom Evaluations
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-400">
              Create and manage custom evaluation configurations
            </p>
          </div>
          <Button onClick={handleCreate} className="flex items-center gap-2">
            <PlusIcon className="w-4 h-4" />
            Create Custom Evaluation
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={Array.isArray(data) ? data : []}
          isFetched={isFetched || pingStatus === "failure"}
          isLoading={isLoading || isDeleting}
          visibilityColumns={{
            name: true,
            evaluationType: true,
            thresholdScore: true,
            enabled: true,
            createdBy: true,
            createdAt: true,
            actions: true,
          }}
          extraFunctions={{
            handleDelete: deleteEvaluation,
            handleEdit: handleEdit,
          }}
        />
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingEvaluation ? "Edit" : "Create"} Custom Evaluation
            </DialogTitle>
          </DialogHeader>
          <CustomEvaluationForm
            evaluation={editingEvaluation}
            onSubmit={handleFormSubmit}
            onCancel={handleFormCancel}
            isLoading={isCreating || isUpdating}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
