import { getCurrentUser } from "@/lib/session";
import { CustomEvaluationConfigService } from "@/lib/platform/evaluation/custom-eval-config";
import { NextRequest } from "next/server";
import { getDBConfigByUser } from "@/lib/db-config";
import { throwIfError } from "@/utils/error";
import getMessage from "@/constants/messages";
import asaw from "@/utils/asaw";
import { spawn } from "child_process";
import { jsonParse } from "@/utils/json";
import {
  testEvaluationRateLimit,
  SecurityValidator,
  getSecurityHeaders,
  logSecurityEvent,
} from "@/lib/platform/evaluation/security";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    throwIfError(!user, getMessage().UNAUTHORIZED_USER);

    await testEvaluationRateLimit(request, user!.email);

    const formData = await request.json();

    const [err, dbConfig] = await asaw(getDBConfigByUser(true));
    if (err || !dbConfig) {
      return Response.json(
        { error: "Database configuration not found" },
        { status: 404 }
      );
    }

    if (!formData.customPrompt || !formData.evaluationType) {
      return Response.json(
        { error: "Missing required fields: customPrompt, evaluationType" },
        { status: 400 }
      );
    }

    const promptSecurity = SecurityValidator.validatePromptSecurity(
      formData.customPrompt
    );
    if (!promptSecurity.valid) {
      logSecurityEvent(
        "TEST_PROMPT_SECURITY_VIOLATION",
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
        "TEST_PROMPT_SECURITY_WARNING",
        {
          warnings: promptSecurity.warnings,
          prompt: formData.customPrompt,
        },
        user!.email,
        request
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

    const { getEvaluationConfig } = await import(
      "@/lib/platform/evaluation/config"
    );
    const evaluationConfig = await getEvaluationConfig(undefined, false);

    if (!evaluationConfig?.id) {
      return Response.json(
        {
          error:
            "Evaluation configuration not found. Please configure LLM settings first.",
        },
        { status: 404 }
      );
    }

    const testCustomConfig = {
      name: (formData.name || "Test Evaluation").trim(),
      description: (formData.description || "Test custom evaluation").trim(),
      customPrompt: formData.customPrompt,
      evaluationType: sanitizedEvalType,
      thresholdScore: formData.thresholdScore || 0.5,
    };

    const testData = {
      prompt: (
        formData.testPrompt || "What is the capital of France?"
      ).substring(0, 1000), // Limit length
      response: (
        formData.testResponse || "The capital of France is Paris."
      ).substring(0, 2000), // Limit length
      contexts: Array.isArray(formData.testContexts)
        ? formData.testContexts
            .slice(0, 10)
            .map((ctx: string) => ctx.substring(0, 500)) // Limit contexts
        : [],
    };

    const testResult = await executeTestEvaluation(
      evaluationConfig,
      testCustomConfig,
      testData
    );

    if (!testResult.success) {
      logSecurityEvent(
        "TEST_EVALUATION_FAILED",
        {
          error: testResult.error,
          config: testCustomConfig,
        },
        user!.email,
        request
      );
      return Response.json(
        { error: `Test evaluation failed: ${testResult.error}` },
        { status: 500 }
      );
    }

    logSecurityEvent(
      "TEST_EVALUATION_SUCCESS",
      {
        evaluationType: testCustomConfig.evaluationType,
      },
      user!.email,
      request
    );

    const response = Response.json({
      success: true,
      data: {
        testResult: testResult.result,
        config: testCustomConfig,
      },
    });

    const securityHeaders = getSecurityHeaders();
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error: any) {
    logSecurityEvent(
      "TEST_CUSTOM_CONFIG_ERROR",
      { error: error.message },
      undefined,
      request
    );
    return Response.json(
      { error: error.message || "Failed to test custom evaluation" },
      { status: 500 }
    );
  }
}

async function executeTestEvaluation(
  evaluationConfig: any,
  customConfig: any,
  testData: { prompt: string; response: string; contexts: string[] }
): Promise<{ success: boolean; result?: any; error?: string }> {
  return new Promise((resolve) => {
    const pythonProcess = spawn("/bin/sh", [
      "-c",
      `
			source venv/bin/activate && \
			python3 scripts/evaluation/evaluate.py '${JSON.stringify({
        spanId: "test-" + Date.now(),
        model: `${evaluationConfig.provider}/${evaluationConfig.model}`,
        api_key: evaluationConfig.secret.value,
        prompt: testData.prompt,
        response: testData.response,
        contexts: testData.contexts,
        threshold_score: 0.5,
        custom_configs: [customConfig],
      })}' && \
			deactivate
		`,
    ]);

    pythonProcess.on("error", (err) => {
      resolve({
        success: false,
        error: `Python process error: ${err.message}`,
      });
    });

    let output = "";
    let errorOutput = "";

    pythonProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    pythonProcess.on("close", (code) => {
      if (code === 0) {
        const match = output.match(/\{.*\}/m);
        if (match) {
          const parsedData = jsonParse(match[0]);
          return resolve({ success: true, result: parsedData });
        }

        return resolve({ success: false, error: output });
      } else {
        resolve({ success: false, error: errorOutput });
      }
    });
  });
}
