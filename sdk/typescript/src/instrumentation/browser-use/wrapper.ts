import { Span, SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import { SDK_NAME } from '../../constant';
import OpenLitHelper, { applyCustomSpanAttributes } from '../../helpers';
import SemanticConvention from '../../semantic-convention';

const SERVER_ADDRESS = 'browser-use.com';
const SERVER_PORT = 443;

const ACTION_PARAM_KEYS = new Set([
  'index',
  'text',
  'url',
  'query',
  'selector',
  'new_tab',
  'down',
  'num_pages',
]);

export interface BrowserUseAgentContext {
  agentName: string;
  sdkVersion: string;
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
  span: Span,
  operation: string,
  sdkVersion: string,
  operationType?: string,
): void {
  span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
  span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE);
  span.setAttribute(
    SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
    SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE,
  );
  span.setAttribute(SemanticConvention.GEN_AI_OPERATION, operation);
  if (operationType) {
    span.setAttribute(SemanticConvention.GEN_AI_OPERATION_TYPE, operationType);
  }
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

function resolveCurrentUrl(instance: any): string | null {
  try {
    const browserSession = instance?.browser_session ?? instance?.browserSession;
    const page = browserSession?.current_page ?? browserSession?.currentPage ?? instance?.page;
    const url = page?.url;
    return typeof url === 'string' && url.trim() ? url : null;
  } catch {
    return null;
  }
}

function resolveMaxSteps(instance: any, args: any[]): number | null {
  for (const arg of args) {
    if (typeof arg === 'number' && Number.isFinite(arg)) {
      return arg;
    }
    if (arg && typeof arg === 'object' && typeof arg.max_steps === 'number') {
      return arg.max_steps;
    }
    if (arg && typeof arg === 'object' && typeof arg.maxSteps === 'number') {
      return arg.maxSteps;
    }
  }
  if (typeof instance?.max_steps === 'number') {
    return instance.max_steps;
  }
  if (typeof instance?.maxSteps === 'number') {
    return instance.maxSteps;
  }
  return null;
}

function applyAgentIdentityAttributes(span: Span, instance: any): void {
  span.setAttribute(
    SemanticConvention.GEN_AI_AGENT_TYPE,
    SemanticConvention.GEN_AI_AGENT_TYPE_BROWSER,
  );

  if (instance?.id !== undefined && instance?.id !== null) {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, String(instance.id));
  }
  if (instance?.task_id !== undefined && instance?.task_id !== null) {
    span.setAttribute(SemanticConvention.GEN_AI_BROWSER_AGENT_TASK_ID, String(instance.task_id));
  }
  if (instance?.session_id !== undefined && instance?.session_id !== null) {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_SESSION_ID, String(instance.session_id));
  }
}

function applyAgentConfigAttributes(span: Span, instance: any, args: any[]): void {
  const maxSteps = resolveMaxSteps(instance, args);
  if (typeof maxSteps === 'number') {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_MAX_STEPS, maxSteps);
  }

  const currentUrl = resolveCurrentUrl(instance);
  if (currentUrl) {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, currentUrl);
  }

  const settings = instance?.settings;
  if (settings && typeof settings === 'object') {
    if (typeof settings.use_vision === 'boolean') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_USE_VISION, settings.use_vision);
    } else if (typeof settings.useVision === 'boolean') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_USE_VISION, settings.useVision);
    }
  }

  if (typeof instance?.use_vision === 'boolean') {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_USE_VISION, instance.use_vision);
  } else if (typeof instance?.useVision === 'boolean') {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_USE_VISION, instance.useVision);
  }

  const profile = instance?.browser_profile ?? instance?.browserProfile;
  if (profile && typeof profile === 'object') {
    if (typeof profile.headless === 'boolean') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_HEADLESS, profile.headless);
    }
    const allowedDomains = profile.allowed_domains ?? profile.allowedDomains;
    if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
      span.setAttribute(
        SemanticConvention.GEN_AI_AGENT_ALLOWED_DOMAINS,
        safeStringify(allowedDomains),
      );
    }
  }
}

function resolveToolDescription(instance: any, actionName: string): string | null {
  try {
    const registry = instance?.registry;
    const action =
      registry?.get_action?.(actionName) ??
      registry?.getAction?.(actionName) ??
      registry?.getActions?.()?.[actionName];
    const description = action?.description;
    return typeof description === 'string' && description.trim() ? description.trim() : null;
  } catch {
    return null;
  }
}

function firstActionEntry(action: Record<string, unknown> | null | undefined): [string, unknown] {
  const entries = action ? Object.entries(action) : [];
  if (entries.length === 0) return ['unknown', {}];
  const [key, value] = entries[0];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return [key, value];
  }
  return [key, value ?? {}];
}

function actionDictFromModel(action: any): Record<string, unknown> | null {
  if (!action || typeof action !== 'object') return null;
  if (typeof action.model_dump === 'function') {
    return action.model_dump();
  }
  if (typeof action.toJSON === 'function') {
    return action.toJSON();
  }
  return action as Record<string, unknown>;
}

function calculateStepStats(history: any[]): {
  successfulSteps: number;
  failedSteps: number;
  totalActions: number;
} {
  let successfulSteps = 0;
  let failedSteps = 0;
  let totalActions = 0;

  for (const step of history) {
    const results = step?.result;
    if (!Array.isArray(results) || results.length === 0) {
      continue;
    }

    let stepSuccess = true;
    for (const result of results) {
      totalActions += 1;
      if (result?.is_success === false || result?.isSuccess === false) {
        stepSuccess = false;
      }
      if (result?.error) {
        stepSuccess = false;
      }
    }

    if (stepSuccess) {
      successfulSteps += 1;
    } else {
      failedSteps += 1;
    }
  }

  return { successfulSteps, failedSteps, totalActions };
}

function captureTokenAndCost(span: Span, response: any, modelName: string | null): void {
  if (!modelName) return;

  const usage = response?.usage;
  if (!usage || typeof usage !== 'object') return;

  const inputTokens = usage.total_input_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0;
  const outputTokens = usage.total_output_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0;

  if (inputTokens > 0) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
  }
  if (outputTokens > 0) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
  }

  const directCost = usage.total_cost ?? usage.cost;
  if (typeof directCost === 'number' && directCost > 0) {
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, directCost);
    return;
  }

  const pricingInfo = OpenlitConfig.pricingInfo;
  if (pricingInfo && inputTokens + outputTokens > 0) {
    const cost = OpenLitHelper.getChatModelCost(
      modelName,
      pricingInfo,
      inputTokens,
      outputTokens,
    );
    if (cost > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, cost);
    }
  }
}

function processAgentHistoryResponse(span: Span, response: any): void {
  if (!response || typeof response !== 'object') return;

  const history = response.history;
  if (!Array.isArray(history)) return;

  const totalSteps = history.length;
  span.setAttribute(SemanticConvention.GEN_AI_AGENT_STEP_COUNT, totalSteps);

  const stats = calculateStepStats(history);
  span.setAttribute(SemanticConvention.GEN_AI_AGENT_TOTAL_ACTIONS, stats.totalActions);
  span.setAttribute(SemanticConvention.GEN_AI_AGENT_SUCCESSFUL_STEPS, stats.successfulSteps);
  span.setAttribute(SemanticConvention.GEN_AI_AGENT_FAILED_STEPS, stats.failedSteps);

  if (totalSteps > 0) {
    span.setAttribute(
      SemanticConvention.GEN_AI_AGENT_SUCCESS_RATE,
      (stats.successfulSteps / totalSteps) * 100,
    );
  }

  if (OpenlitConfig.captureMessageContent) {
    const finalResult =
      typeof response.final_result === 'function'
        ? response.final_result()
        : response.finalResult?.() ?? response.finalResult ?? response.final_result;
    if (finalResult) {
      span.setAttribute(
        SemanticConvention.GEN_AI_AGENT_FINAL_RESULT,
        truncateContent(String(finalResult)),
      );
    }
  }

  if (typeof response.total_duration_seconds === 'function') {
    const duration = response.total_duration_seconds();
    if (typeof duration === 'number') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_EXECUTION_TIME, duration);
    }
  } else if (typeof response.totalDurationSeconds === 'function') {
    const duration = response.totalDurationSeconds();
    if (typeof duration === 'number') {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_EXECUTION_TIME, duration);
    }
  }
}

function createIndividualActionSpan(
  tracer: Tracer,
  ctx: BrowserUseAgentContext,
  actionName: string,
  actionData: unknown,
  actionIndex: number,
  step: any,
): void {
  const span = tracer.startSpan(`invoke_agent ${actionName}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
      [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_BROWSER_USE,
    },
  });

  setCommonSpanAttributes(
    span,
    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    ctx.sdkVersion,
    SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
  );
  span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, ctx.agentName);
  span.setAttribute(SemanticConvention.GEN_AI_ACTION_TYPE, actionName);
  span.setAttribute(SemanticConvention.GEN_AI_ACTION_INDEX, actionIndex + 1);

  if (actionData && typeof actionData === 'object') {
    for (const [key, value] of Object.entries(actionData as Record<string, unknown>)) {
      if (ACTION_PARAM_KEYS.has(key) && value !== undefined && value !== null) {
        span.setAttribute(`gen_ai.action.${key}`, truncateContent(String(value)));
      }
    }
  }

  const results = step?.result;
  if (Array.isArray(results) && results[actionIndex]) {
    const result = results[actionIndex];
    if (typeof result?.is_success === 'boolean') {
      span.setAttribute(SemanticConvention.GEN_AI_ACTION_SUCCESS, result.is_success);
    } else if (typeof result?.isSuccess === 'boolean') {
      span.setAttribute(SemanticConvention.GEN_AI_ACTION_SUCCESS, result.isSuccess);
    }
    if (result?.error && OpenlitConfig.captureMessageContent) {
      span.setAttribute(SemanticConvention.GEN_AI_ACTION_ERROR, truncateContent(String(result.error)));
    }
  }

  const stepState = step?.state;
  if (stepState?.url) {
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, String(stepState.url));
  }
  if (stepState?.title && OpenlitConfig.captureMessageContent) {
    span.setAttribute(
      SemanticConvention.GEN_AI_AGENT_PAGE_TITLE,
      truncateContent(String(stepState.title)),
    );
  }

  applyCustomSpanAttributes(span);
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

function createDetailedStepSpan(
  tracer: Tracer,
  agentInstance: any,
  ctx: BrowserUseAgentContext,
): void {
  const history =
    agentInstance?.state?.history?.history ??
    agentInstance?.state?.history ??
    agentInstance?.history?.history;
  if (!Array.isArray(history) || history.length === 0) {
    return;
  }

  const latestStep = history[history.length - 1];
  const stepNumber = history.length;
  const span = tracer.startSpan(`execute_task step ${stepNumber}`, { kind: SpanKind.INTERNAL });

  setCommonSpanAttributes(
    span,
    'step',
    ctx.sdkVersion,
    SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
  );
  span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, ctx.agentName);
  span.setAttribute(SemanticConvention.GEN_AI_AGENT_STEP_COUNT, stepNumber);

  const modelOutput = latestStep?.model_output ?? latestStep?.modelOutput;
  if (modelOutput && typeof modelOutput === 'object') {
    if (modelOutput.thinking && OpenlitConfig.captureMessageContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_AGENT_THINKING,
        truncateContent(String(modelOutput.thinking)),
      );
    }
    if (modelOutput.memory && OpenlitConfig.captureMessageContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_AGENT_MEMORY,
        truncateContent(String(modelOutput.memory)),
      );
    }
    if (modelOutput.next_goal && OpenlitConfig.captureMessageContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_AGENT_NEXT_GOAL,
        truncateContent(String(modelOutput.next_goal ?? modelOutput.nextGoal)),
      );
    }
    const evaluation =
      modelOutput.evaluation_previous_goal ?? modelOutput.evaluationPreviousGoal;
    if (evaluation && OpenlitConfig.captureMessageContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_AGENT_EVALUATION,
        truncateContent(String(evaluation)),
      );
    }

    const actions = modelOutput.action ?? modelOutput.actions;
    if (Array.isArray(actions)) {
      const actionsSummary: string[] = [];
      actions.forEach((action: any, index: number) => {
        const actionDict = actionDictFromModel(action);
        const [actionName] = firstActionEntry(actionDict);
        actionsSummary.push(actionName);
        createIndividualActionSpan(
          tracer,
          ctx,
          actionName,
          actionDict?.[actionName],
          index,
          latestStep,
        );
      });
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_ACTIONS, safeStringify(actionsSummary));
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_ACTIONS_COUNT, actions.length);
    }
  }

  const state = latestStep?.state;
  if (state && typeof state === 'object') {
    if (state.url) {
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, String(state.url));
    }
    if (state.title && OpenlitConfig.captureMessageContent) {
      span.setAttribute(
        SemanticConvention.GEN_AI_AGENT_PAGE_TITLE,
        truncateContent(String(state.title)),
      );
    }
  }

  applyCustomSpanAttributes(span);
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

function createStepSpansFromHistory(
  tracer: Tracer,
  agentInstance: any,
  response: any,
  ctx: BrowserUseAgentContext,
): void {
  const history =
    response?.history ??
    agentInstance?.state?.history?.history ??
    agentInstance?.state?.history;
  if (!Array.isArray(history)) return;

  history.forEach((_step: any, index: number) => {
    const stepNumber = index + 1;
    const step = history[index];
    const span = tracer.startSpan(`execute_task step ${stepNumber}`, { kind: SpanKind.INTERNAL });
    setCommonSpanAttributes(
      span,
      'step',
      ctx.sdkVersion,
      SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
    );
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, ctx.agentName);
    span.setAttribute(SemanticConvention.GEN_AI_AGENT_STEP_COUNT, stepNumber);

    const modelOutput = step?.model_output ?? step?.modelOutput;
    const actions = modelOutput?.action ?? modelOutput?.actions;
    if (Array.isArray(actions)) {
      const actionsSummary: string[] = [];
      actions.forEach((action: any, actionIndex: number) => {
        const actionDict = actionDictFromModel(action);
        const [actionName] = firstActionEntry(actionDict);
        actionsSummary.push(actionName);
        createIndividualActionSpan(
          tracer,
          ctx,
          actionName,
          actionDict?.[actionName],
          actionIndex,
          step,
        );
      });
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_ACTIONS, safeStringify(actionsSummary));
      span.setAttribute(SemanticConvention.GEN_AI_AGENT_ACTIONS_COUNT, actions.length);
    }

    applyCustomSpanAttributes(span);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  });
}

function findRunOptionsArg(args: any[]): { index: number; options: Record<string, any> } | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || typeof arg !== 'object' || Array.isArray(arg)) continue;
    if (
      'on_step_end' in arg ||
      'on_step_start' in arg ||
      'onStepEnd' in arg ||
      'onStepStart' in arg ||
      'max_steps' in arg ||
      'maxSteps' in arg
    ) {
      return { index, options: arg };
    }
  }
  return null;
}

function installStepHooks(
  tracer: Tracer,
  agentInstance: any,
  ctx: BrowserUseAgentContext,
  args: any[],
  onStepCompleted: () => void,
): any[] {
  const patchedArgs = [...args];
  let optionsEntry = findRunOptionsArg(patchedArgs);

  if (!optionsEntry) {
    const options: Record<string, any> = {};
    patchedArgs.push(options);
    optionsEntry = { index: patchedArgs.length - 1, options };
  }

  const options = optionsEntry.options;
  const originalOnStepEnd = options.on_step_end ?? options.onStepEnd;
  const originalOnStepStart = options.on_step_start ?? options.onStepStart;

  options.on_step_end = options.onStepEnd = async (agent: any) => {
    createDetailedStepSpan(tracer, agent ?? agentInstance, ctx);
    onStepCompleted();
    if (typeof originalOnStepEnd === 'function') {
      await originalOnStepEnd(agent);
    }
  };

  options.on_step_start = options.onStepStart = async (agent: any) => {
    if (typeof originalOnStepStart === 'function') {
      await originalOnStepStart(agent);
    }
  };

  patchedArgs[optionsEntry.index] = options;
  return patchedArgs;
}

function finalizeSpan(span: Span, startTime: number): void {
  span.setAttribute(
    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
    (Date.now() - startTime) / 1000,
  );
  span.end();
}

class BrowserUseWrapper {
  static _patchAgentRun(tracer: Tracer, version?: string): any {
    const sdkVersion = version || 'unknown';

    return (originalMethod: (...args: any[]) => any) => {
      return async function wrappedAgentRun(this: any, ...args: any[]) {
        if (isTracingSuppressed(context.active())) {
          return originalMethod.apply(this, args);
        }

        const agentName = resolveAgentName(this);
        const ctx: BrowserUseAgentContext = { agentName, sdkVersion };
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
          sdkVersion,
          SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        );
        span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);
        applyAgentIdentityAttributes(span, this);
        applyAgentConfigAttributes(span, this, args);

        const description = resolveAgentDescription(this);
        if (description) {
          span.setAttribute(
            SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
            truncateContent(description),
          );
          if (OpenlitConfig.captureMessageContent) {
            span.setAttribute(
              SemanticConvention.GEN_AI_INPUT_MESSAGES,
              buildUserMessage(description),
            );
          }
        }

        const model = resolveModelName(this);
        if (model) {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
        }

        applyCustomSpanAttributes(span);

        let stepSpansCreated = false;
        const patchedArgs = installStepHooks(tracer, this, ctx, args, () => {
          stepSpansCreated = true;
        });

        try {
          const result = await context.with(trace.setSpan(context.active(), span), () =>
            originalMethod.apply(this, patchedArgs),
          );

          processAgentHistoryResponse(span, result);
          captureTokenAndCost(span, result, model);
          if (!stepSpansCreated) {
            createStepSpansFromHistory(tracer, this, result, ctx);
          }

          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          throw e;
        } finally {
          finalizeSpan(span, startTime);
        }
      };
    };
  }

  static _patchAgentStep(tracer: Tracer, version?: string): any {
    const sdkVersion = version || 'unknown';

    return (originalMethod: (...args: any[]) => any) => {
      return async function wrappedAgentStep(this: any, ...args: any[]) {
        if (isTracingSuppressed(context.active())) {
          return originalMethod.apply(this, args);
        }

        const agentName = resolveAgentName(this);
        const stepCount =
          this?.step_count ??
          this?.stepCount ??
          this?.state?.history?.history?.length ??
          this?.state?.history?.length;
        const model = resolveModelName(this);
        const spanName =
          typeof stepCount === 'number'
            ? `execute_task step ${stepCount}`
            : `invoke_model ${model ?? 'llm'}`;

        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        setCommonSpanAttributes(
          span,
          'step',
          sdkVersion,
          SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
        );
        span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);
        applyAgentIdentityAttributes(span, this);
        if (typeof stepCount === 'number') {
          span.setAttribute(SemanticConvention.GEN_AI_AGENT_STEP_COUNT, stepCount);
        }
        if (model) {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model);
        }
        applyCustomSpanAttributes(span);

        try {
          const result = await context.with(trace.setSpan(context.active(), span), () =>
            originalMethod.apply(this, args),
          );
          if (result && typeof result === 'object') {
            if (typeof result.is_success === 'boolean') {
              span.setAttribute(SemanticConvention.GEN_AI_ACTION_SUCCESS, result.is_success);
            }
            if (result.error && OpenlitConfig.captureMessageContent) {
              span.setAttribute(SemanticConvention.GEN_AI_ACTION_ERROR, truncateContent(String(result.error)));
            }
          }
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          throw e;
        } finally {
          finalizeSpan(span, startTime);
        }
      };
    };
  }

  static _patchAgentLifecycle(tracer: Tracer, operation: string, version?: string): any {
    const sdkVersion = version || 'unknown';

    return (originalMethod: (...args: any[]) => any) => {
      return async function wrappedAgentLifecycle(this: any, ...args: any[]) {
        if (isTracingSuppressed(context.active())) {
          return originalMethod.apply(this, args);
        }

        const agentName = resolveAgentName(this);
        const span = tracer.startSpan(`browser ${operation}`, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        setCommonSpanAttributes(
          span,
          operation,
          sdkVersion,
          SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
        );
        span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, agentName);
        applyAgentIdentityAttributes(span, this);
        applyCustomSpanAttributes(span);

        try {
          const result = await context.with(trace.setSpan(context.active(), span), () =>
            originalMethod.apply(this, args),
          );
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          throw e;
        } finally {
          finalizeSpan(span, startTime);
        }
      };
    };
  }

  static _patchControllerAct(tracer: Tracer, version?: string): any {
    const sdkVersion = version || 'unknown';

    return (originalMethod: (...args: any[]) => any) => {
      return async function wrappedControllerAct(
        this: any,
        action: Record<string, unknown>,
        ...rest: any[]
      ) {
        if (isTracingSuppressed(context.active())) {
          return originalMethod.apply(this, [action, ...rest]);
        }

        const [actionName, params] = firstActionEntry(action);
        const span = tracer.startSpan(`invoke_agent ${actionName}`, {
          kind: SpanKind.INTERNAL,
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
          sdkVersion,
          SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
        );
        span.setAttribute(SemanticConvention.GEN_AI_ACTION_TYPE, actionName);
        span.setAttribute(SemanticConvention.GEN_AI_ACTION_INDEX, 1);

        const controllerAgentName = resolveAgentName(this);
        if (controllerAgentName !== 'browser_use') {
          span.setAttribute(SemanticConvention.GEN_AI_AGENT_NAME, controllerAgentName);
        }

        const description = resolveToolDescription(this, actionName);
        if (description) {
          span.setAttribute(
            SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
            truncateContent(description),
          );
        }

        if (params && typeof params === 'object') {
          for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
            if (ACTION_PARAM_KEYS.has(key) && value !== undefined && value !== null) {
              span.setAttribute(`gen_ai.action.${key}`, truncateContent(String(value)));
            }
          }
        }

        if (OpenlitConfig.captureMessageContent && params !== undefined) {
          span.setAttribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
            truncateContent(safeStringify(params)),
          );
        }

        applyCustomSpanAttributes(span);

        try {
          const result = await originalMethod.apply(this, [action, ...rest]);
          if (result && typeof result === 'object') {
            if (typeof result.is_success === 'boolean') {
              span.setAttribute(SemanticConvention.GEN_AI_ACTION_SUCCESS, result.is_success);
            } else if (typeof result.isSuccess === 'boolean') {
              span.setAttribute(SemanticConvention.GEN_AI_ACTION_SUCCESS, result.isSuccess);
            }
            if (result.error && OpenlitConfig.captureMessageContent) {
              span.setAttribute(
                SemanticConvention.GEN_AI_ACTION_ERROR,
                truncateContent(String(result.error)),
              );
            }
          }
          if (OpenlitConfig.captureMessageContent && result !== undefined) {
            span.setAttribute(
              SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
              truncateContent(safeStringify(result)),
            );
          }
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          throw e;
        } finally {
          finalizeSpan(span, startTime);
        }
      };
    };
  }
}

export default BrowserUseWrapper;
