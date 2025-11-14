import { getCurrentUser } from "@/lib/session";
import {
  CustomEvaluationConfigService,
  createCustomEvaluationConfig,
  getCustomEvaluationConfigs,
} from "@/lib/platform/evaluation/custom-eval-config";
import {
  CreateCustomEvaluationConfig,
  UpdateCustomEvaluationConfig,
} from "@/types/evaluation";
import { NextRequest } from "next/server";
import { getDBConfigByUser } from "@/lib/db-config";
import { throwIfError } from "@/utils/error";
import getMessage from "@/constants/messages";
import asaw from "@/utils/asaw";
import {
  configManagementRateLimit,
  SecurityValidator,
  getSecurityHeaders,
  logSecurityEvent,
} from "@/lib/platform/evaluation/security";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    throwIfError(!user, getMessage().UNAUTHORIZED_USER);

    await configManagementRateLimit(request, user!.email);

    const { searchParams } = new URL(request.url);
    const enabled = searchParams.get("enabled");

    const [err, dbConfig] = await asaw(getDBConfigByUser(true));
    if (err || !dbConfig) {
      return Response.json(
        { error: "Database configuration not found" },
        { status: 404 }
      );
    }

    const { data: customConfigs, error } = await getCustomEvaluationConfigs(
      dbConfig.id,
      enabled === "true" ? true : enabled === "false" ? false : undefined,
      dbConfig.id
    );

    if (error) {
      return Response.json({ error }, { status: 500 });
    }

    const response = Response.json({
      success: true,
      data: customConfigs || [],
    });

    const securityHeaders = getSecurityHeaders();
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error: any) {
    logSecurityEvent(
      "GET_CUSTOM_CONFIGS_ERROR",
      { error: error.message },
      undefined,
      request
    );
    return Response.json(
      { error: error.message || "Failed to fetch custom evaluations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    throwIfError(!user, getMessage().UNAUTHORIZED_USER);

    await configManagementRateLimit(request, user!.email);

    const formData = await request.json();

    const [err, dbConfig] = await asaw(getDBConfigByUser(true));
    if (err || !dbConfig) {
      return Response.json(
        { error: "Database configuration not found" },
        { status: 404 }
      );
    }

    if (!formData.name || !formData.evaluationType || !formData.customPrompt) {
      return Response.json(
        {
          error: "Missing required fields: name, evaluationType, customPrompt",
        },
        { status: 400 }
      );
    }

    const nameValidation = SecurityValidator.validateEvaluationName(
      formData.name
    );
    if (!nameValidation.valid) {
      logSecurityEvent(
        "INVALID_EVALUATION_NAME",
        { name: formData.name },
        user!.email,
        request
      );
      return Response.json({ error: nameValidation.error }, { status: 400 });
    }

    const descValidation = SecurityValidator.validateDescription(
      formData.description || ""
    );
    if (!descValidation.valid) {
      logSecurityEvent(
        "INVALID_DESCRIPTION",
        { description: formData.description },
        user!.email,
        request
      );
      return Response.json({ error: descValidation.error }, { status: 400 });
    }

    const thresholdValidation = SecurityValidator.validateThresholdScore(
      formData.thresholdScore || 0.5
    );
    if (!thresholdValidation.valid) {
      return Response.json(
        { error: thresholdValidation.error },
        { status: 400 }
      );
    }

    const promptValidation =
      CustomEvaluationConfigService.validatePromptTemplate(
        formData.customPrompt
      );
    if (!promptValidation.valid) {
      return Response.json(
        { error: "Invalid prompt template", details: promptValidation.errors },
        { status: 400 }
      );
    }

    const promptSecurity = SecurityValidator.validatePromptSecurity(
      formData.customPrompt
    );
    if (!promptSecurity.valid) {
      logSecurityEvent(
        "PROMPT_SECURITY_VIOLATION",
        {
          errors: promptSecurity.errors,
          warnings: promptSecurity.warnings,
          prompt: formData.customPrompt,
        },
        user!.email,
        request
      );
      return Response.json(
        { error: "Security validation failed", details: promptSecurity.errors },
        { status: 400 }
      );
    }

    if (promptSecurity.warnings.length > 0) {
      logSecurityEvent(
        "PROMPT_SECURITY_WARNING",
        {
          warnings: promptSecurity.warnings,
          prompt: formData.customPrompt,
        },
        user!.email,
        request
      );
    }

    const sanitizedEvalType = SecurityValidator.sanitizeEvaluationType(
      formData.evaluationType
    );
    const typeValidation =
      CustomEvaluationConfigService.validateEvaluationType(sanitizedEvalType);
    if (!typeValidation.valid) {
      return Response.json(
        { error: "Invalid evaluation type", details: typeValidation.errors },
        { status: 400 }
      );
    }

    const customEvaluationConfig: CreateCustomEvaluationConfig = {
      databaseConfigId: dbConfig.id,
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      customPrompt: formData.customPrompt,
      evaluationType: sanitizedEvalType,
      thresholdScore: formData.thresholdScore || 0.5,
      enabled: formData.enabled !== false, // default to true
      createdBy: user!.email || user!.id,
      meta: formData.meta || {},
    };

    const { data: customConfig, error } = await createCustomEvaluationConfig(
      customEvaluationConfig,
      dbConfig.id
    );

    if (error) {
      return Response.json({ error }, { status: 400 });
    }

    logSecurityEvent(
      "CUSTOM_EVALUATION_CREATED",
      {
        evaluationType: customConfig!.evaluationType,
        configId: customConfig!.id,
      },
      user!.email,
      request
    );

    const response = Response.json({
      success: true,
      data: customConfig,
    });

    const securityHeaders = getSecurityHeaders();
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error: any) {
    logSecurityEvent(
      "CREATE_CUSTOM_CONFIG_ERROR",
      { error: error.message },
      undefined,
      request
    );
    return Response.json(
      { error: error.message || "Failed to create custom evaluation" },
      { status: 500 }
    );
  }
}
