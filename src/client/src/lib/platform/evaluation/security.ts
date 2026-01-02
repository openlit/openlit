import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { throwIfError } from "@/utils/error";
import getMessage from "@/constants/messages";

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

export function createRateLimit(options: RateLimitOptions) {
  const { maxRequests, windowMs } = options;

  return async (request: NextRequest, userEmail?: string) => {
    const identifier = userEmail || request.ip || "anonymous";
    const now = Date.now();

    rateLimitStore.forEach((value, key) => {
      if (now > value.resetTime) {
        rateLimitStore.delete(key);
      }
    });

    let record = rateLimitStore.get(identifier);
    if (!record || now > record.resetTime) {
      record = { count: 0, resetTime: now + windowMs };
      rateLimitStore.set(identifier, record);
    }

    if (record.count >= maxRequests) {
      const resetTimeMs = record.resetTime - now;
      const resetTimeSeconds = Math.ceil(resetTimeMs / 1000);

      throw new Error(
        `Rate limit exceeded. Try again in ${resetTimeSeconds} seconds.`
      );
    }

    record.count++;
    rateLimitStore.set(identifier, record);

    return {
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - record.count),
      resetTime: record.resetTime,
    };
  };
}

export class SecurityValidator {
  static validatePromptSecurity(prompt: string): {
    valid: boolean;
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];

    const dangerousPatterns = [
      {
        pattern: /system\s*[:\s]*ignore/i,
        message: "Potential system instruction override",
        severity: "error",
      },
      {
        pattern: /forget\s+previous\s+instructions/i,
        message: "Attempt to override previous instructions",
        severity: "error",
      },
      {
        pattern: /new\s+instructions/i,
        message: "Attempt to introduce new instructions",
        severity: "warning",
      },
      {
        pattern: /ignore\s+all\s+previous/i,
        message: "Attempt to ignore context",
        severity: "error",
      },
      {
        pattern: /act\s+as\s+if/i,
        message: "Role manipulation attempt",
        severity: "warning",
      },
      {
        pattern: /pretend\s+to\s+be/i,
        message: "Identity manipulation attempt",
        severity: "warning",
      },
      {
        pattern: /jailbreak|DAN|do\s+anything\s+now/i,
        message: "Jailbreak attempt detected",
        severity: "error",
      },
    ];

    dangerousPatterns.forEach(({ pattern, message, severity }) => {
      if (pattern.test(prompt)) {
        if (severity === "error") {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    });

    const specialCharRatio =
      (prompt.match(/[{}[\]();]/g) || []).length / prompt.length;
    if (specialCharRatio > 0.1) {
      warnings.push("High concentration of special characters detected");
    }

    const codePatterns = [
      /eval\s*\(/i,
      /exec\s*\(/i,
      /import\s+/i,
      /require\s*\(/i,
      /process\./i,
      /__.*__/i,
    ];

    codePatterns.forEach((pattern) => {
      if (pattern.test(prompt)) {
        errors.push("Potential code injection pattern detected");
      }
    });

    return {
      valid: errors.length === 0,
      warnings,
      errors,
    };
  }

  static sanitizeEvaluationType(evaluationType: string): string {
    return evaluationType.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  }

  static validateThresholdScore(score: number): {
    valid: boolean;
    error?: string;
  } {
    if (typeof score !== "number" || isNaN(score)) {
      return { valid: false, error: "Threshold score must be a number" };
    }

    if (score < 0 || score > 1) {
      return { valid: false, error: "Threshold score must be between 0 and 1" };
    }

    return { valid: true };
  }

  static validateEvaluationName(name: string): {
    valid: boolean;
    error?: string;
  } {
    if (!name || name.trim().length === 0) {
      return { valid: false, error: "Evaluation name is required" };
    }

    if (name.length > 100) {
      return {
        valid: false,
        error: "Evaluation name must be 100 characters or less",
      };
    }

    if (/<script|<iframe|javascript:|data:/i.test(name)) {
      return { valid: false, error: "Invalid characters in evaluation name" };
    }

    return { valid: true };
  }

  static validateDescription(description: string): {
    valid: boolean;
    error?: string;
  } {
    if (description && description.length > 1000) {
      return {
        valid: false,
        error: "Description must be 1000 characters or less",
      };
    }

    if (/<script|<iframe|javascript:|data:/i.test(description)) {
      return { valid: false, error: "Invalid characters in description" };
    }

    return { valid: true };
  }
}

export async function authenticateUser(request: NextRequest) {
  const user = await getCurrentUser();
  throwIfError(!user, getMessage().UNAUTHORIZED_USER);

  return user;
}

export function getSecurityHeaders() {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

export function logSecurityEvent(
  event: string,
  details: any,
  userEmail?: string,
  request?: NextRequest
) {
  console.warn("[SECURITY]", {
    event,
    timestamp: new Date().toISOString(),
    userEmail,
    ip: request?.ip,
    userAgent: request?.headers.get("user-agent"),
    details,
  });
}

export const evaluationRateLimit = createRateLimit({
  maxRequests: 10, // 10 requests per window
  windowMs: 60000, // 1 minute
});

export const testEvaluationRateLimit = createRateLimit({
  maxRequests: 5, // 5 test requests per window
  windowMs: 300000, // 5 minutes
});

export const configManagementRateLimit = createRateLimit({
  maxRequests: 20, // 20 config operations per window
  windowMs: 60000, // 1 minute
});
