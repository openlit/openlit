/**
 * browser-use span wrappers.
 *
 * Emits OTel GenAI semantic-convention compliant spans:
 *   invoke_agent  — Agent.run  (full browser task session)
 *   execute_tool  — Agent.step (individual browser action)
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/browser_use/async_browser_use.py
 */

import { Tracer, SpanKind, context, trace } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import { applyCustomSpanAttributes } from '../../helpers';
import { SDK_NAME, SDK_VERSION } from '../../constant';

const AI_SYSTEM = 'browser_use';

function setCommonAttrs(span: any): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || 'default');
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || 'default');
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, AI_SYSTEM);
}

function resolveAgentName(instance: any): string {
  return instance?.agent_id || instance?.task?.substring?.(0, 40) || 'browser_agent';
}

function resolveTask(instance: any): string | undefined {
  try {
    return typeof instance?.task === 'string' ? instance.task : undefined;
  } catch {
    return undefined;
  }
}

class BrowserUseWrapper {
  /**
   * Wrap Agent.run — emits an invoke_agent span covering the full browser automation task.
   */
  static patchAgentRun(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const agentName = resolveAgentName(this);
        const task = resolveTask(this);
        const spanName = `invoke_agent ${agentName}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI_SYSTEM,
            [SemanticConvention.GEN_AI_AGENT_NAME]: agentName,
          },
        });

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            setCommonAttrs(span);
            applyCustomSpanAttributes(span);

            if (task && OpenlitConfig.captureMessageContent) {
              span.setAttribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                OpenLitHelper.buildInputMessages([{ role: 'user', content: task }])
              );
            }

            const result = await originalMethod.apply(this, args);

            if (result && OpenlitConfig.captureMessageContent) {
              try {
                const resultStr = typeof result === 'string' ? result :
                  result?.result || result?.final_result || JSON.stringify(result);
                if (resultStr) {
                  span.setAttribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    OpenLitHelper.buildOutputMessages(String(resultStr), 'stop')
                  );
                }
              } catch { /* ignore */ }
            }

            span.setStatus({ code: 1 /* OK */ });
            return result;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  /**
   * Wrap Agent.step — emits an execute_tool span for each individual browser action.
   */
  static patchAgentStep(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const stepNum = (this?.n_steps ?? this?.step_count ?? 0) + 1;
        const spanName = `execute_tool browser_step_${stepNum}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.INTERNAL,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI_SYSTEM,
            [SemanticConvention.GEN_AI_TOOL_NAME]: `browser_step_${stepNum}`,
          },
        });

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            setCommonAttrs(span);

            const result = await originalMethod.apply(this, args);

            if (result && OpenlitConfig.captureMessageContent) {
              try {
                const actionStr =
                  result?.model_output?.action
                    ? JSON.stringify(result.model_output.action)
                    : typeof result === 'string' ? result : undefined;
                if (actionStr) {
                  span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, actionStr);
                }
              } catch { /* ignore */ }
            }

            span.setStatus({ code: 1 /* OK */ });
            return result;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
          }
        });
      };
    };
  }
}

export default BrowserUseWrapper;
