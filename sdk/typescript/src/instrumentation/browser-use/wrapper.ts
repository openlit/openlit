import { SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import { SDK_NAME } from '../../constant';
import OpenLitHelper, { applyCustomSpanAttributes } from '../../helpers';
import SemanticConvention from '../../semantic-convention';

const SERVER_ADDRESS = 'browser-use.com';
const SERVER_PORT = 443;

let browserUseSdkVersion = 'unknown';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  browserUseSdkVersion = require('browser-use/package.json')?.version || 'unknown';
} catch {
  browserUseSdkVersion = 'unknown';
}

function truncateContent(content: string): string {
  const maxLen = OpenlitConfig.maxContentLength;
  if (typeof maxLen === 'number' && maxLen > 0 && content.length > maxLen) {
    return content.slice(0, maxLen);
  }
  return content;
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildUserMessage(content: string): string {
  return JSON.stringify([
    {
      role: 'user',
      parts: [{ type: 'text', content: truncateContent(content) }],
    },
  ]);
}

function setCommonSpanAttributes(
  span: any,
  operation: string,
  sdkVersion: string = browserUseSdkVersion
): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE);
  span.setAttribute(
    SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
    SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE
  );
  span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operation);
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || '');
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || '');
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, sdkVersion);
  span.setAttribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS);
  span.setAttribute(SemanticConvention.SERVER_PORT, SERVER_PORT);
}

function resolveAgentName(instance: any): string {
  const explicitName = instance?.name ?? instance?.agent_name;
  if (typeof explicitName === 'string' && explicitName.trim()) {
    return explicitName.trim();
  }
  return 'browser_use';
}

function resolveAgentDescription(instance: any): string | null {
  if (typeof instance?.task === 'string' && instance.task.trim()) {
    return instance.task.trim();
  }
  return null;
}

function resolveAgentId(instance: any): string | null {
  for (const key of ['id', 'task_id', 'session_id']) {
    const value = instance?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }
  return null;
}

function resolveModelName(instance: any): string | null {
  const llm = instance?.llm;
  if (!llm) return null;

  for (const key of ['model_name', 'model', 'name']) {
    const value = llm?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function resolveToolDescription(instance: any, actionName: string): string | null {
  try {
    const action = instance?.registry?.get_action?.(actionName);
    const description = action?.description;
    return typeof description === 'string' && description.trim() ? description.trim() : null;
  } catch {
    return null;
  }
}

function firstActionEntry(action: Record<string, unknown> | null | undefined): [string, unknown] {
  const entries = action ? Object.entries(action) : [];
  if (entries.length === 0) return ['unknown', {}];
  return entries[0];
}

class BrowserUseWrapper {
  static _patchAgentRun(tracer: Tracer, version?: string): any {
    const sdkVersion = version || browserUseSdkVersion;

    return (originalMethod: (...args: any[]) => any) => {
      return async function wrappedAgentRun(this: any, ...args: any[]) {
        const agentName = resolveAgentName(this);
        const span = tracer.startSpan(`invoke_agent ${agentName}`, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]:
              SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE,
          },
        });
        const startTime = Date.now();

        setCommonSpanAttributes(
          span,
          SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
          sdkVersion
        );
        span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);

        const agentId = resolveAgentId(this);
        if (agentId) {
          span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, agentId);
        }

        const description = resolveAgentDescription(this);
        if (description) {
          span.setAttribute(
            SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
            truncateContent(description)
          );
          if (OpenlitConfig.captureMessageContent) {
            span.setAttribute(
              SemanticConvention.GEN_AI_INPUT_MESSAGES,
              buildUserMessage(description)
            );
          }
        }

        const model = resolveModelName(this);
        if (model) {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
        }

        applyCustomSpanAttributes(span);

        try {
          const result = await context.with(trace.setSpan(context.active(), span), () =>
            originalMethod.apply(this, args)
          );
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          throw e;
        } finally {
          span.setAttribute(
            SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
            (Date.now() - startTime) / 1000
          );
          span.end();
        }
      };
    };
  }

  static _patchControllerAct(tracer: Tracer, version?: string): any {
    const sdkVersion = version || browserUseSdkVersion;

    return (originalMethod: (...args: any[]) => any) => {
      return async function wrappedControllerAct(
        this: any,
        action: Record<string, unknown>,
        ...args: any[]
      ) {
        const [actionName, params] = firstActionEntry(action);
        const span = tracer.startSpan(`execute_tool ${actionName}`, {
          kind: SpanKind.INTERNAL,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]:
              SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE,
          },
        });
        const startTime = Date.now();

        setCommonSpanAttributes(
          span,
          SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
          sdkVersion
        );
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_NAME, actionName);
        span.setAttribute(SemanticConvention.GEN_AI_TOOL_TYPE_OTEL, 'browser_action');

        const description = resolveToolDescription(this, actionName);
        if (description) {
          span.setAttribute(
            SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
            truncateContent(description)
          );
        }

        if (OpenlitConfig.captureMessageContent && params !== undefined) {
          span.setAttribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
            truncateContent(safeStringify(params))
          );
        }

        applyCustomSpanAttributes(span);

        try {
          const result = await originalMethod.apply(this, [action, ...args]);
          if (OpenlitConfig.captureMessageContent && result !== undefined) {
            span.setAttribute(
              SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
              truncateContent(safeStringify(result))
            );
          }
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          throw e;
        } finally {
          span.setAttribute(
            SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
            (Date.now() - startTime) / 1000
          );
          span.end();
        }
      };
    };
  }
}

export default BrowserUseWrapper;
