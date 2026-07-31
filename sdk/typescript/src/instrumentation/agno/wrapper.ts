/**
 * Agno framework span wrappers.
 *
 * Emits OTel GenAI semantic-convention compliant spans:
 *   invoke_agent    — Agent.run / Agent.arun (emits create_agent on first call)
 *   invoke_workflow — Team.run / Team.arun
 *   execute_tool    — FunctionCall.execute / FunctionCall.aexecute
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/agno/agno.py
 */

import { Tracer, SpanKind, context, trace, SpanContext } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import { applyCustomSpanAttributes } from '../../helpers';
import { SDK_NAME, SDK_VERSION } from '../../constant';

const AI_SYSTEM = SemanticConvention.GEN_AI_SYSTEM_AGNO;

// Registry: agent name -> create_agent span context (for Links on invoke_agent)
const agentRegistry = new Map<string, SpanContext>();

function setCommonAttrs(span: any): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || 'default');
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || 'default');
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, AI_SYSTEM);
}

function resolveAgentName(instance: any): string {
  return instance?.name || instance?.agent_id || instance?.constructor?.name || 'agent';
}

function resolveModel(instance: any): string {
  try {
    return (
      instance?.model?.id ||
      instance?.model?.model ||
      instance?.model?.name ||
      instance?.model_id ||
      ''
    );
  } catch {
    return '';
  }
}

class AgnoWrapper {
  static patchAgentRun(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const agentName = resolveAgentName(this);
        const model = resolveModel(this);
        const operationName = SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT;
        const spanName = `invoke_agent ${agentName}`;

        const creationCtx = agentRegistry.get(agentName);
        const links = creationCtx ? [{ context: creationCtx }] : [];

        // Emit create_agent span on first encounter (best-effort approximation)
        if (!agentRegistry.has(agentName)) {
          const createSpan = tracer.startSpan(`create_agent ${agentName}`, {
            kind: SpanKind.CLIENT,
            attributes: {
              [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
              [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI_SYSTEM,
              [SemanticConvention.GEN_AI_AGENT_NAME]: agentName,
              ...(model ? { [SemanticConvention.GEN_AI_REQUEST_MODEL]: model } : {}),
            },
          });
          try {
            setCommonAttrs(createSpan);
            if (this.description) {
              createSpan.setAttribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, String(this.description));
            }
            agentRegistry.set(agentName, createSpan.spanContext());
          } finally {
            createSpan.end();
          }
        }

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationName,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI_SYSTEM,
            [SemanticConvention.GEN_AI_AGENT_NAME]: agentName,
            ...(model ? { [SemanticConvention.GEN_AI_REQUEST_MODEL]: model } : {}),
          },
          links,
        });

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            setCommonAttrs(span);
            applyCustomSpanAttributes(span);

            const result = await originalMethod.apply(this, args);

            if (OpenlitConfig.captureMessageContent) {
              try {
                const inputMsg = args[0];
                if (inputMsg) {
                  const inputStr = typeof inputMsg === 'string' ? inputMsg : JSON.stringify(inputMsg);
                  span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES,
                    OpenLitHelper.buildInputMessages([{ role: 'user', content: inputStr }]));
                }
                if (result?.content) {
                  const outputStr = typeof result.content === 'string' ? result.content :
                    Array.isArray(result.content)
                      ? result.content.map((c: any) => c?.text || c?.value || JSON.stringify(c)).join('')
                      : JSON.stringify(result.content);
                  span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    OpenLitHelper.buildOutputMessages(outputStr, 'stop'));
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

  static patchTeamRun(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const teamName = this?.name || this?.team_id || 'team';
        const spanName = `invoke_workflow ${teamName}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.INTERNAL,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI_SYSTEM,
            [SemanticConvention.GEN_AI_WORKFLOW_NAME]: teamName,
          },
        });

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            setCommonAttrs(span);
            applyCustomSpanAttributes(span);
            const result = await originalMethod.apply(this, args);
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

  static patchToolExecute(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const toolName = this?.function?.name || this?.name || 'tool';
        const spanName = `execute_tool ${toolName}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.INTERNAL,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI_SYSTEM,
            [SemanticConvention.GEN_AI_TOOL_NAME]: toolName,
          },
        });

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            setCommonAttrs(span);

            if (OpenlitConfig.captureMessageContent && this?.arguments) {
              try {
                const argsStr = typeof this.arguments === 'string'
                  ? this.arguments
                  : JSON.stringify(this.arguments);
                span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, argsStr);
              } catch { /* ignore */ }
            }

            const result = await originalMethod.apply(this, args);

            if (OpenlitConfig.captureMessageContent && result !== undefined) {
              try {
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                span.setAttribute(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, resultStr);
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

export default AgnoWrapper;
