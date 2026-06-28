/**
 * Microsoft Agent Framework span wrappers.
 *
 * Emits OTel GenAI semantic-convention compliant spans:
 *   create_agent     — Agent construction
 *   invoke_agent     — Agent.run
 *   execute_tool     — FunctionTool.invoke
 *   invoke_workflow  — Workflow.run
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/agent_framework/__init__.py
 */

import { Tracer, SpanKind, context, trace, SpanContext } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from '../../semantic-convention';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import { applyCustomSpanAttributes } from '../../helpers';
import { SDK_NAME, SDK_VERSION } from '../../constant';

const AI_SYSTEM = 'agent_framework';

// Thread-safe agent creation registry (maps agent name -> SpanContext)
const agentRegistry = new Map<string, SpanContext>();

function setCommonAttrs(span: any): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName || 'default');
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment || 'default');
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, AI_SYSTEM);
}

function resolveAgentName(instance: any): string {
  return instance?.name || instance?.agent_id || instance?.id || instance?.constructor?.name || 'agent';
}

function resolveModel(instance: any): string | undefined {
  try {
    return instance?.model?.id || instance?.model_id || instance?.llm?.model_id || undefined;
  } catch {
    return undefined;
  }
}

class AgentFrameworkWrapper {
  /**
   * Patch Agent class to emit create_agent spans on construction.
   * We mark the prototype with a sentinel so we only patch once.
   */
  static patchAgentInit(AgentClass: any, tracer: Tracer): void {
    try {
      AgentClass.prototype.__openlit_af_init_patched = true;
      // Emit the create_agent span lazily on first invoke_agent instead of
      // intercepting the constructor (which is complex in JS). The registry-based
      // approach is used: the first time Agent.run is called, a create_agent span
      // is emitted if not already registered.
    } catch { /* ignore */ }
  }

  static patchAgentRun(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const agentName = resolveAgentName(this);
        const model = resolveModel(this);

        // Emit create_agent span on first encounter
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
            if (this.tools) {
              try {
                const toolNames = Array.isArray(this.tools)
                  ? this.tools.map((t: any) => t?.name || t?.function?.name || String(t)).filter(Boolean)
                  : [];
                if (toolNames.length > 0) {
                  createSpan.setAttribute(SemanticConvention.GEN_AI_TOOL_DEFINITIONS, JSON.stringify(toolNames));
                }
              } catch { /* ignore */ }
            }
            agentRegistry.set(agentName, createSpan.spanContext());
          } finally {
            createSpan.end();
          }
        }

        const creationCtx = agentRegistry.get(agentName);
        const links = creationCtx ? [{ context: creationCtx }] : [];
        const span = tracer.startSpan(`invoke_agent ${agentName}`, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
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

            if (OpenlitConfig.captureMessageContent && args[0]) {
              try {
                const inputStr = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
                span.setAttribute(
                  SemanticConvention.GEN_AI_INPUT_MESSAGES,
                  OpenLitHelper.buildInputMessages([{ role: 'user', content: inputStr }])
                );
              } catch { /* ignore */ }
            }

            const result = await originalMethod.apply(this, args);

            if (OpenlitConfig.captureMessageContent && result) {
              try {
                const outputStr = typeof result === 'string' ? result :
                  result?.content || result?.result || result?.output || JSON.stringify(result);
                if (outputStr) {
                  span.setAttribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    OpenLitHelper.buildOutputMessages(String(outputStr), 'stop')
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

  static patchToolInvoke(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const toolName = this?.name || this?.function?.name || this?.func?.name || 'tool';
        const span = tracer.startSpan(`execute_tool ${toolName}`, {
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

            if (OpenlitConfig.captureMessageContent && args[0]) {
              try {
                const argsStr = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
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

  static patchWorkflowRun(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const workflowName = this?.name || this?.workflow_id || 'workflow';
        const span = tracer.startSpan(`invoke_workflow ${workflowName}`, {
          kind: SpanKind.INTERNAL,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: AI_SYSTEM,
            [SemanticConvention.GEN_AI_WORKFLOW_NAME]: workflowName,
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
}

export default AgentFrameworkWrapper;
