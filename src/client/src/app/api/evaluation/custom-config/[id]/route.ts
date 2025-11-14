import { getCurrentUser } from "@/lib/session";
import {
  CustomEvaluationConfigService,
  getCustomEvaluationConfigById,
  updateCustomEvaluationConfig,
  deleteCustomEvaluationConfig,
} from "@/lib/platform/evaluation/custom-eval-config";
import { UpdateCustomEvaluationConfig } from "@/types/evaluation";
import { NextRequest } from "next/server";
import { getDBConfigByUser } from "@/lib/db-config";
import { throwIfError } from "@/utils/error";
import getMessage from "@/constants/messages";
import asaw from "@/utils/asaw";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    throwIfError(!user, getMessage().UNAUTHORIZED_USER);

    const [err, dbConfig] = await asaw(getDBConfigByUser(true));
    if (err || !dbConfig) {
      return Response.json(
        { error: "Database configuration not found" },
        { status: 404 }
      );
    }

    const { data: customConfig, error } = await getCustomEvaluationConfigById(
      params.id,
      dbConfig.id
    );

    if (error) {
      return Response.json({ error }, { status: 404 });
    }

    return Response.json({
      success: true,
      data: customConfig,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Failed to fetch custom evaluation" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    throwIfError(!user, getMessage().UNAUTHORIZED_USER);

    const formData = await request.json();

    const [err, dbConfig] = await asaw(getDBConfigByUser(true));
    if (err || !dbConfig) {
      return Response.json(
        { error: "Database configuration not found" },
        { status: 404 }
      );
    }

    // Validate prompt template if provided
    if (formData.customPrompt) {
      const promptValidation =
        CustomEvaluationConfigService.validatePromptTemplate(
          formData.customPrompt
        );
      if (!promptValidation.valid) {
        return Response.json(
          {
            error: "Invalid prompt template",
            details: promptValidation.errors,
          },
          { status: 400 }
        );
      }
    }

    // Validate evaluation type if provided
    if (formData.evaluationType) {
      const typeValidation =
        CustomEvaluationConfigService.validateEvaluationType(
          formData.evaluationType
        );
      if (!typeValidation.valid) {
        return Response.json(
          { error: "Invalid evaluation type", details: typeValidation.errors },
          { status: 400 }
        );
      }
    }

    const updates: UpdateCustomEvaluationConfig = {};

    // Only include fields that are provided
    if (formData.name !== undefined) updates.name = formData.name;
    if (formData.description !== undefined)
      updates.description = formData.description;
    if (formData.customPrompt !== undefined)
      updates.customPrompt = formData.customPrompt;
    if (formData.evaluationType !== undefined)
      updates.evaluationType = formData.evaluationType;
    if (formData.thresholdScore !== undefined)
      updates.thresholdScore = formData.thresholdScore;
    if (formData.enabled !== undefined) updates.enabled = formData.enabled;
    if (formData.meta !== undefined) updates.meta = formData.meta;

    const { data: success, error } = await updateCustomEvaluationConfig(
      params.id,
      updates,
      dbConfig.id
    );

    if (error) {
      return Response.json({ error }, { status: 400 });
    }

    return Response.json({
      success: true,
      data: { updated: success },
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Failed to update custom evaluation" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    throwIfError(!user, getMessage().UNAUTHORIZED_USER);

    const [err, dbConfig] = await asaw(getDBConfigByUser(true));
    if (err || !dbConfig) {
      return Response.json(
        { error: "Database configuration not found" },
        { status: 404 }
      );
    }

    const { data: success, error } = await deleteCustomEvaluationConfig(
      params.id,
      dbConfig.id
    );

    if (error) {
      return Response.json({ error }, { status: 400 });
    }

    return Response.json({
      success: true,
      data: { deleted: success },
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Failed to delete custom evaluation" },
      { status: 500 }
    );
  }
}
