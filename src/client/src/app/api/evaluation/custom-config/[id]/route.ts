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
