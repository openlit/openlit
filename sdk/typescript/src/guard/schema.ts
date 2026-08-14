/**
 * Schema validation guard for structured LLM outputs.
 *
 * Validates that model output is valid JSON and/or conforms to a JSON schema.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/schema.py
 */

import { Guard, GuardPhase, GuardResult, makeGuardResult, GuardOptions } from './base';

function validateJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
  path = '',
): string | null {
  const schemaType = schema.type as string | undefined;
  if (schemaType) {
    const typeMap: Record<string, (v: unknown) => boolean> = {
      object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
      array: (v) => Array.isArray(v),
      string: (v) => typeof v === 'string',
      number: (v) => typeof v === 'number',
      integer: (v) => typeof v === 'number' && Number.isInteger(v),
      boolean: (v) => typeof v === 'boolean',
      null: (v) => v === null,
    };
    const checker = typeMap[schemaType];
    if (checker && !checker(data)) {
      const actual = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
      return `Expected ${schemaType} at ${path || 'root'}, got ${actual}`;
    }
  }

  if (schemaType === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const dataObj = data as Record<string, unknown>;
    const required = (schema.required as string[]) || [];
    for (const fieldName of required) {
      if (!(fieldName in dataObj)) {
        return `Missing required field '${fieldName}' at ${path || 'root'}`;
      }
    }

    const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
    for (const [propName, propSchema] of Object.entries(properties)) {
      if (propName in dataObj) {
        const err = validateJsonSchema(dataObj[propName], propSchema, `${path}.${propName}`);
        if (err) return err;
      }
    }
  }

  if (schemaType === 'array' && Array.isArray(data)) {
    const itemsSchema = schema.items as Record<string, unknown> | undefined;
    if (itemsSchema) {
      for (let i = 0; i < data.length; i++) {
        const err = validateJsonSchema(data[i], itemsSchema, `${path}[${i}]`);
        if (err) return err;
      }
    }
  }

  return null;
}

export interface SchemaOptions extends GuardOptions {
  jsonMode?: boolean;
  schema?: Record<string, unknown>;
}

export class Schema extends Guard {
  readonly name = 'schema';
  readonly phases = [GuardPhase.POSTFLIGHT];

  private readonly _jsonMode: boolean;
  private readonly _schema: Record<string, unknown> | null;

  constructor(opts: SchemaOptions = {}) {
    super({ action: opts.action ?? 'deny', maxScanLength: opts.maxScanLength });
    this._jsonMode = opts.jsonMode ?? false;
    this._schema = opts.schema ?? null;
  }

  evaluate(text: string): GuardResult {
    const stripped = text.trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return makeGuardResult({
        action: this._action,
        score: 1.0,
        guardName: this.name,
        classification: 'invalid_json',
        explanation: `Output is not valid JSON: ${message}`,
      });
    }

    if (this._schema) {
      const err = validateJsonSchema(parsed, this._schema);
      if (err) {
        return makeGuardResult({
          action: this._action,
          score: 0.9,
          guardName: this.name,
          classification: 'schema_mismatch',
          explanation: err,
        });
      }
    }

    return makeGuardResult({ guardName: this.name });
  }
}
