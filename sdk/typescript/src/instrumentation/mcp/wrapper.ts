import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class MCPWrapper extends BaseWrapper {
  static genAiSystem = SemanticConvention.GEN_AI_SYSTEM_MCP;
  static serverAddress = 'localhost';

  static _setCommonAttributes(span: any, operation: string) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(
      SemanticConvention.GEN_AI_OPERATION_NAME,
      operation,
    );
    span.setAttribute(
      SemanticConvention.GEN_AI_SYSTEM_NAME,
      MCPWrapper.genAiSystem,
    );
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(
      SemanticConvention.GEN_AI_APPLICATION_NAME,
      applicationName,
    );
  }

  static _patchCallTool(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const toolName: string = args[0]?.name || 'unknown';
        const spanName = `execute_tool ${toolName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MCPWrapper._setCommonAttributes(
              span,
              SemanticConvention.GEN_AI_OPERATION_EXECUTE_TOOL,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_TOOL_NAME,
              toolName,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_DURATION,
              duration,
            );

            if (response?.content) {
              const contentCount = Array.isArray(response.content)
                ? response.content.length
                : 1;
              span.setAttribute(
                SemanticConvention.GEN_AI_RESPONSE_ID,
                contentCount,
              );
            }

            if (response?.isError) {
              span.setAttribute(SemanticConvention.ERROR_TYPE, 'true');
            }

            const metrics = {
              duration,
              requestCount: 1,
              successCount: response?.isError ? 0 : 1,
              failureCount: response?.isError ? 1 : 0,
            };
            BaseWrapper.recordMetrics(
              MCPWrapper.genAiSystem,
              'callTool',
              metrics,
            );

            return response;
          } catch (error: any) {
            OpenLitHelper.handleException(span, error);
            const duration = (Date.now() - startTime) / 1000;
            const metrics = {
              duration,
              requestCount: 1,
              successCount: 0,
              failureCount: 1,
            };
            BaseWrapper.recordMetrics(
              MCPWrapper.genAiSystem,
              'callTool',
              metrics,
            );
            throw error;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchListTools(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan('list_tools', { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MCPWrapper._setCommonAttributes(
              span,
              SemanticConvention.GEN_AI_OPERATION_INVOKE_WORKFLOW,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_DURATION,
              duration,
            );

            if (response?.tools) {
              span.setAttribute(
                SemanticConvention.GEN_AI_TOOL_NAME + '.count',
                response.tools.length,
              );
            }

            return response;
          } catch (error: any) {
            OpenLitHelper.handleException(span, error);
            throw error;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchGetPrompt(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const promptName: string = args[0]?.name || 'unknown';
        const spanName = `invoke_agent ${promptName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MCPWrapper._setCommonAttributes(
              span,
              SemanticConvention.GEN_AI_OPERATION_INVOKE_AGENT,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_AGENT_NAME,
              promptName,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_DURATION,
              duration,
            );

            if (response?.messages) {
              span.setAttribute(
                SemanticConvention.GEN_AI_RESPONSE_ID,
                response.messages.length,
              );
            }

            return response;
          } catch (error: any) {
            OpenLitHelper.handleException(span, error);
            throw error;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchListPrompts(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan('list_prompts', {
          kind: SpanKind.CLIENT,
        });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MCPWrapper._setCommonAttributes(
              span,
              SemanticConvention.GEN_AI_OPERATION_INVOKE_WORKFLOW,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_DURATION,
              duration,
            );

            if (response?.prompts) {
              span.setAttribute(
                SemanticConvention.GEN_AI_AGENT_NAME + '.count',
                response.prompts.length,
              );
            }

            return response;
          } catch (error: any) {
            OpenLitHelper.handleException(span, error);
            throw error;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchReadResource(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const resourceUri: string = args[0]?.uri || 'unknown';
        const spanName = `retrieval ${resourceUri}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MCPWrapper._setCommonAttributes(
              span,
              SemanticConvention.GEN_AI_OPERATION_RETRIEVAL,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_RETRIEVAL_URI,
              resourceUri,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_DURATION,
              duration,
            );

            if (response?.contents) {
              span.setAttribute(
                SemanticConvention.GEN_AI_RESPONSE_ID,
                response.contents.length,
              );
            }

            return response;
          } catch (error: any) {
            OpenLitHelper.handleException(span, error);
            throw error;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  static _patchListResources(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan('list_resources', {
          kind: SpanKind.CLIENT,
        });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MCPWrapper._setCommonAttributes(
              span,
              SemanticConvention.GEN_AI_OPERATION_INVOKE_WORKFLOW,
            );
            span.setAttribute(
              SemanticConvention.GEN_AI_REQUEST_DURATION,
              duration,
            );

            if (response?.resources) {
              span.setAttribute(
                SemanticConvention.GEN_AI_RETRIEVAL_URI + '.count',
                response.resources.length,
              );
            }

            return response;
          } catch (error: any) {
            OpenLitHelper.handleException(span, error);
            throw error;
          } finally {
            span.end();
          }
        });
      };
    };
  }
}

export default MCPWrapper;
