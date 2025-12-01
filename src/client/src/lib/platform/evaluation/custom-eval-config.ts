import { dataCollector } from "@/lib/platform/common";
import { CUSTOM_EVALUATION_CONFIGS_TABLE_NAME } from "./custom-configs-table-details";
import {
  CustomEvaluationConfig,
  CreateCustomEvaluationConfig,
  UpdateCustomEvaluationConfig,
} from "@/types/evaluation";
import { randomUUID } from "crypto";
import getMessage from "@/constants/messages";
import Sanitizer from "@/utils/sanitizer";

export class CustomEvaluationConfigService {
  static async create(
    config: CreateCustomEvaluationConfig,
    dbConfigId?: string
  ): Promise<{ data?: CustomEvaluationConfig; error?: string }> {
    try {
      const existingConfig = await this.findByEvaluationType(
        config.evaluationType,
        config.databaseConfigId,
        dbConfigId
      );

      if (existingConfig.data) {
        return {
          error: `Evaluation type '${config.evaluationType}' already exists`,
        };
      }

      const id = randomUUID();
      const now = new Date().toISOString();

      const { err } = await dataCollector(
        {
          table: CUSTOM_EVALUATION_CONFIGS_TABLE_NAME,
          values: [
            {
              id,
              database_config_id: config.databaseConfigId,
              name: config.name,
              description: config.description,
              custom_prompt: config.customPrompt,
              evaluation_type: config.evaluationType,
              threshold_score: config.thresholdScore,
              enabled: config.enabled ? 1 : 0,
              created_by: config.createdBy,
              meta: config.meta || {},
            },
          ],
        },
        "insert",
        dbConfigId
      );

      if (err) {
        return { error: err.toString() };
      }

      return {
        data: {
          ...config,
          id,
          createdAt: now,
          updatedAt: now,
        },
      };
    } catch (error: any) {
      return { error: error.message || "Failed to create custom evaluation" };
    }
  }

  static async findMany(
    databaseConfigId: string,
    enabled?: boolean,
    dbConfigId?: string
  ): Promise<{ data?: CustomEvaluationConfig[]; error?: string }> {
    try {
      const sanitizedDbConfigId = Sanitizer.sanitizeValue(databaseConfigId);

      let whereClause = `WHERE database_config_id = '${sanitizedDbConfigId}'`;
      if (enabled !== undefined) {
        whereClause += ` AND enabled = ${enabled ? 1 : 0}`;
      }

      const query = `
				SELECT 
					id,
					database_config_id as databaseConfigId,
					name,
					description,
					custom_prompt as customPrompt,
					evaluation_type as evaluationType,
					threshold_score as thresholdScore,
					enabled,
					created_by as createdBy,
					created_at as createdAt,
					updated_at as updatedAt,
					meta
				FROM ${CUSTOM_EVALUATION_CONFIGS_TABLE_NAME}
				${whereClause}
				ORDER BY created_at DESC
			`;

      const { data, err } = await dataCollector({ query }, "query", dbConfigId);

      if (err) {
        return { error: err.toString() };
      }

      const configs =
        (data as any[])?.map((config) => ({
          ...config,
          enabled: Boolean(config.enabled),
          thresholdScore: Number(config.thresholdScore),
          meta: this.parseJSON(config.meta),
        })) || [];

      return { data: configs };
    } catch (error: any) {
      return { error: error.message || "Failed to fetch custom evaluations" };
    }
  }

  static async findById(
    id: string,
    dbConfigId?: string
  ): Promise<{ data?: CustomEvaluationConfig; error?: string }> {
    try {
      const sanitizedId = Sanitizer.sanitizeValue(id);

      const query = `
				SELECT 
					id,
					database_config_id as databaseConfigId,
					name,
					description,
					custom_prompt as customPrompt,
					evaluation_type as evaluationType,
					threshold_score as thresholdScore,
					enabled,
					created_by as createdBy,
					created_at as createdAt,
					updated_at as updatedAt,
					meta
				FROM ${CUSTOM_EVALUATION_CONFIGS_TABLE_NAME}
				WHERE id = '${sanitizedId}'
				LIMIT 1
			`;

      const { data, err } = await dataCollector({ query }, "query", dbConfigId);

      if (err) {
        return { error: err.toString() };
      }

      const configs = data as any[];
      if (!configs?.length) {
        return { error: getMessage().EVALUATION_CONFIG_NOT_FOUND };
      }

      const config = configs[0];
      return {
        data: {
          ...config,
          enabled: Boolean(config.enabled),
          thresholdScore: Number(config.thresholdScore),
          meta: this.parseJSON(config.meta),
        },
      };
    } catch (error: any) {
      return { error: error.message || "Failed to fetch custom evaluation" };
    }
  }

  static async findByEvaluationType(
    evaluationType: string,
    databaseConfigId: string,
    dbConfigId?: string,
    excludeId?: string
  ): Promise<{ data?: CustomEvaluationConfig; error?: string }> {
    try {
      const sanitizedEvalType = Sanitizer.sanitizeValue(evaluationType);
      const sanitizedDbConfigId = Sanitizer.sanitizeValue(databaseConfigId);

      let whereClause = `WHERE database_config_id = '${sanitizedDbConfigId}' AND evaluation_type = '${sanitizedEvalType}'`;
      if (excludeId) {
        const sanitizedExcludeId = Sanitizer.sanitizeValue(excludeId);
        whereClause += ` AND id != '${sanitizedExcludeId}'`;
      }

      const query = `
				SELECT 
					id,
					database_config_id as databaseConfigId,
					name,
					description,
					custom_prompt as customPrompt,
					evaluation_type as evaluationType,
					threshold_score as thresholdScore,
					enabled,
					created_by as createdBy,
					created_at as createdAt,
					updated_at as updatedAt,
					meta
				FROM ${CUSTOM_EVALUATION_CONFIGS_TABLE_NAME}
				${whereClause}
				LIMIT 1
			`;

      const { data, err } = await dataCollector({ query }, "query", dbConfigId);

      if (err) {
        return { error: err.toString() };
      }

      const configs = data as any[];
      if (!configs?.length) {
        return { data: undefined };
      }

      const config = configs[0];
      return {
        data: {
          ...config,
          enabled: Boolean(config.enabled),
          thresholdScore: Number(config.thresholdScore),
          meta: this.parseJSON(config.meta),
        },
      };
    } catch (error: any) {
      return { error: error.message || "Failed to fetch custom evaluation" };
    }
  }

  static async update(
    id: string,
    updates: UpdateCustomEvaluationConfig,
    dbConfigId?: string
  ): Promise<{ data?: boolean; error?: string }> {
    try {
      if (updates.evaluationType) {
        const currentConfig = await this.findById(id, dbConfigId);
        if (!currentConfig.data) {
          return { error: "Custom evaluation configuration not found" };
        }

        const existingConfig = await this.findByEvaluationType(
          updates.evaluationType,
          currentConfig.data.databaseConfigId,
          dbConfigId,
          id
        );

        if (existingConfig.data) {
          return {
            error: `Evaluation type '${updates.evaluationType}' already exists`,
          };
        }
      }

      const sanitizedId = Sanitizer.sanitizeValue(id);
      const updateFields: string[] = [];
      const values: Record<string, any> = {};

      if (updates.name !== undefined) {
        updateFields.push("name = {name:String}");
        values.name = updates.name;
      }
      if (updates.description !== undefined) {
        updateFields.push("description = {description:String}");
        values.description = updates.description;
      }
      if (updates.customPrompt !== undefined) {
        updateFields.push("custom_prompt = {custom_prompt:String}");
        values.custom_prompt = updates.customPrompt;
      }
      if (updates.evaluationType !== undefined) {
        updateFields.push("evaluation_type = {evaluation_type:String}");
        values.evaluation_type = updates.evaluationType;
      }
      if (updates.thresholdScore !== undefined) {
        updateFields.push("threshold_score = {threshold_score:Float64}");
        values.threshold_score = updates.thresholdScore;
      }
      if (updates.enabled !== undefined) {
        updateFields.push("enabled = {enabled:UInt8}");
        values.enabled = updates.enabled ? 1 : 0;
      }
      if (updates.meta !== undefined) {
        updateFields.push("meta = {meta:String}");
        values.meta = JSON.stringify(updates.meta);
      }

      if (updateFields.length === 0) {
        return { data: true };
      }

      updateFields.push("updated_at = now()");

      const query = `
				ALTER TABLE ${CUSTOM_EVALUATION_CONFIGS_TABLE_NAME}
				UPDATE ${updateFields.join(", ")}
				WHERE id = '${sanitizedId}'
			`;

      const { err } = await dataCollector(
        {
          query,
          query_params: values,
        },
        "command",
        dbConfigId
      );

      if (err) {
        return { error: err.toString() };
      }

      return { data: true };
    } catch (error: any) {
      return { error: error.message || "Failed to update custom evaluation" };
    }
  }

  static async delete(
    id: string,
    dbConfigId?: string
  ): Promise<{ data?: boolean; error?: string }> {
    try {
      const sanitizedId = Sanitizer.sanitizeValue(id);

      const query = `
				ALTER TABLE ${CUSTOM_EVALUATION_CONFIGS_TABLE_NAME}
				DELETE WHERE id = '${sanitizedId}'
			`;

      const { err } = await dataCollector({ query }, "command", dbConfigId);

      if (err) {
        return { error: err.toString() };
      }

      return { data: true };
    } catch (error: any) {
      return { error: error.message || "Failed to delete custom evaluation" };
    }
  }

  static validatePromptTemplate(prompt: string): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check for required placeholders
    const requiredPlaceholders = ["{prompt}", "{response}"];
    requiredPlaceholders.forEach((placeholder) => {
      if (!prompt.includes(placeholder)) {
        errors.push(`Missing required placeholder: ${placeholder}`);
      }
    });

    // Check prompt length
    if (prompt.length > 5000) {
      errors.push("Prompt exceeds maximum length of 5000 characters");
    }

    if (prompt.length < 10) {
      errors.push("Prompt is too short (minimum 10 characters)");
    }

    // Basic injection detection
    const dangerousPatterns = [
      /system\s*[:\s]*ignore/i,
      /forget\s+previous\s+instructions/i,
      /new\s+instructions/i,
      /ignore\s+all\s+previous/i,
    ];

    dangerousPatterns.forEach((pattern, index) => {
      if (pattern.test(prompt)) {
        errors.push(
          `Potential prompt injection detected (pattern ${index + 1})`
        );
      }
    });

    return { valid: errors.length === 0, errors };
  }

  static validateEvaluationType(evaluationType: string): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check format: alphanumeric + underscores, no spaces
    if (!/^[a-zA-Z0-9_]+$/.test(evaluationType)) {
      errors.push(
        "Evaluation type must contain only letters, numbers, and underscores"
      );
    }

    // Check length
    if (evaluationType.length < 2) {
      errors.push("Evaluation type must be at least 2 characters long");
    }

    if (evaluationType.length > 50) {
      errors.push("Evaluation type must be no more than 50 characters long");
    }

    // Check reserved names
    const reservedTypes = ["Bias", "Toxicity", "Hallucination"];
    if (reservedTypes.includes(evaluationType)) {
      errors.push(
        `Evaluation type '${evaluationType}' is reserved for built-in evaluations`
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Parse JSON string safely
   */
  private static parseJSON(jsonString: string): Record<string, any> {
    try {
      return JSON.parse(jsonString || "{}");
    } catch {
      return {};
    }
  }
}

/**
 * Legacy function aliases for backward compatibility
 */
export async function createCustomEvaluationConfig(
  config: CreateCustomEvaluationConfig,
  dbConfigId?: string
) {
  return CustomEvaluationConfigService.create(config, dbConfigId);
}

export async function getCustomEvaluationConfigs(
  databaseConfigId: string,
  enabled?: boolean,
  dbConfigId?: string
) {
  return CustomEvaluationConfigService.findMany(
    databaseConfigId,
    enabled,
    dbConfigId
  );
}

export async function getCustomEvaluationConfigById(
  id: string,
  dbConfigId?: string
) {
  return CustomEvaluationConfigService.findById(id, dbConfigId);
}

export async function updateCustomEvaluationConfig(
  id: string,
  updates: UpdateCustomEvaluationConfig,
  dbConfigId?: string
) {
  return CustomEvaluationConfigService.update(id, updates, dbConfigId);
}

export async function deleteCustomEvaluationConfig(
  id: string,
  dbConfigId?: string
) {
  return CustomEvaluationConfigService.delete(id, dbConfigId);
}
