"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatSummary = formatSummary;
exports.formatBatchSummary = formatBatchSummary;
exports.runEval = runEval;
exports.runEvalBatch = runEvalBatch;
exports.fetchEvalTypes = fetchEvalTypes;
const config_1 = __importDefault(require("../config"));
const types_1 = require("./types");
const HTTP_TIMEOUT = 120000;
function resolveApiKey(explicit) {
    const key = explicit || config_1.default.openlitApiKey || process.env.OPENLIT_API_KEY;
    if (!key)
        throw new Error('Missing OpenLIT API key. Provide via openlitApiKey parameter, ' +
            'openlit.init({ openlitApiKey }), or set the OPENLIT_API_KEY env var.');
    return key;
}
function resolveUrl(explicit) {
    const url = explicit || config_1.default.openlitUrl || process.env.OPENLIT_URL;
    if (!url)
        throw new Error('Missing OpenLIT URL. Provide via openlitUrl parameter, ' +
            'openlit.init({ openlitUrl }), or set the OPENLIT_URL env var.');
    let end = url.length;
    while (end > 0 && url[end - 1] === '/')
        end--;
    return url.slice(0, end);
}
function resolveAttributes(explicit) {
    const attrs = {};
    const otelRes = process.env.OTEL_RESOURCE_ATTRIBUTES || '';
    if (otelRes) {
        for (const pair of otelRes.split(',')) {
            const trimmed = pair.trim();
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                attrs[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
            }
        }
    }
    const otelSvc = process.env.OTEL_SERVICE_NAME;
    if (otelSvc)
        attrs['service.name'] = otelSvc;
    const otelEnv = process.env.OPENLIT_ENVIRONMENT || process.env.OTEL_DEPLOYMENT_ENVIRONMENT;
    if (otelEnv)
        attrs['deployment.environment'] = otelEnv;
    const cfgApp = config_1.default.applicationName;
    if (cfgApp && cfgApp !== 'default')
        attrs['service.name'] = cfgApp;
    const cfgEnv = config_1.default.environment;
    if (cfgEnv && cfgEnv !== 'default')
        attrs['deployment.environment'] = cfgEnv;
    if (explicit)
        Object.assign(attrs, explicit);
    return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}
function isTTY() {
    try {
        return !!process.stderr?.isTTY;
    }
    catch {
        return false;
    }
}
function c(code, text) {
    return isTTY() ? `\x1b[${code}m${text}\x1b[0m` : text;
}
function formatSummary(result) {
    const lines = [];
    if (!result.success) {
        lines.push(c('31', `Evaluation failed: ${result.error || 'unknown error'}`));
        return lines.join('\n');
    }
    const passed = (0, types_1.isPassed)(result);
    const status = passed ? c('32', 'PASSED') : c('31', 'FAILED');
    lines.push(`\n${c('1', 'OpenLIT Offline Evaluation')} — ${status}`);
    lines.push(c('2', '─'.repeat(50)));
    for (const e of result.evaluations) {
        const flag = e.verdict.toLowerCase() !== 'yes' ? c('32', '✓') : c('31', '✗');
        lines.push(`  ${flag} ${c('1', e.type)}: score=${e.score.toFixed(2)}  ` +
            `verdict=${e.verdict}  class=${e.classification}`);
        if (e.explanation) {
            lines.push(`    ${c('2', e.explanation.slice(0, 200))}`);
        }
    }
    if (result.contextApplied?.ruleMatched) {
        lines.push(`\n  ${c('36', 'Context')}: ${result.contextApplied.contextEntityIds.length} ` +
            `entities from ${result.contextApplied.matchingRuleIds.length} rules`);
    }
    if (result.contextApplied && result.contextApplied.userContextsCount > 0) {
        lines.push(`  ${c('36', 'User contexts')}: ${result.contextApplied.userContextsCount}`);
    }
    if (result.metadata) {
        if (result.metadata.model)
            lines.push(`  ${c('2', `Model: ${result.metadata.model}`)}`);
        if (result.metadata.runId)
            lines.push(`  ${c('2', `Run: ${result.metadata.runId}`)}`);
    }
    lines.push('');
    return lines.join('\n');
}
function formatBatchSummary(batch) {
    const lines = [];
    const total = batch.results.length;
    const passedCount = batch.results.filter(r => (0, types_1.isPassed)(r)).length;
    const failed = total - passedCount;
    const allPassed = total > 0 && failed === 0;
    const rate = total > 0 ? passedCount / total : 0;
    const status = allPassed ? c('32', 'ALL PASSED') : c('31', `${failed} FAILED`);
    lines.push(`\n${c('1', 'OpenLIT Batch Evaluation')} — ${status}`);
    lines.push(c('2', '═'.repeat(50)));
    lines.push(`  Total: ${total}  Passed: ${c('32', String(passedCount))}  ` +
        `Failed: ${c('31', String(failed))}  ` +
        `Rate: ${(rate * 100).toFixed(0)}%`);
    if (batch.runId)
        lines.push(`  Run ID: ${batch.runId}`);
    lines.push(c('2', '─'.repeat(50)));
    for (let i = 0; i < batch.results.length; i++) {
        const r = batch.results[i];
        const flag = (0, types_1.isPassed)(r) ? c('32', '✓') : c('31', '✗');
        if (r.success) {
            const typesStr = r.evaluations.map(e => e.type).join(', ');
            lines.push(`  ${flag} [${i + 1}/${total}] ${typesStr}`);
        }
        else {
            lines.push(`  ${flag} [${i + 1}/${total}] Error: ${r.error}`);
        }
    }
    lines.push('');
    return lines.join('\n');
}
function parseEvalResponse(data) {
    const evaluations = (data.evaluations || []).map((e) => ({
        type: e.type || '',
        score: Number(e.score) || 0,
        verdict: e.verdict || '',
        classification: e.classification || '',
        explanation: e.explanation || '',
    }));
    let contextApplied;
    if (data.context_applied) {
        contextApplied = {
            ruleMatched: data.context_applied.ruleMatched || false,
            matchingRuleIds: data.context_applied.matchingRuleIds || [],
            contextEntityIds: data.context_applied.contextEntityIds || [],
            userContextsCount: data.context_applied.userContextsCount || 0,
        };
    }
    return {
        success: data.success || false,
        evaluations,
        contextApplied,
        metadata: data.metadata,
        error: data.err,
    };
}
async function runEval(options) {
    const apiKey = resolveApiKey(options.openlitApiKey);
    const url = resolveUrl(options.openlitUrl);
    const mergedAttributes = resolveAttributes(options.attributes);
    const payload = {
        prompt: options.prompt,
        response: options.response,
    };
    if (options.contexts)
        payload.contexts = options.contexts;
    if (options.evalTypes)
        payload.eval_types = options.evalTypes;
    if (options.thresholdScore !== undefined)
        payload.threshold_score = options.thresholdScore;
    if (options.storeResults !== undefined)
        payload.store_results = options.storeResults;
    if (options.runId)
        payload.run_id = options.runId;
    if (options.metadata)
        payload.metadata = options.metadata;
    if (Object.keys(mergedAttributes).length > 0)
        payload.attributes = mergedAttributes;
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };
    const endpoint = `${url}/api/evaluation/offline`;
    const printResults = options.printResults !== false;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
            let resp;
            try {
                resp = await fetch(endpoint, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers,
                    signal: controller.signal,
                });
            }
            finally {
                clearTimeout(timer);
            }
            if (resp.status === 401) {
                return { success: false, evaluations: [], error: 'Authentication failed. Check your OpenLIT API key.' };
            }
            if (resp.status === 429 && attempt === 0) {
                lastErr = new Error('Rate limited (429)');
                continue;
            }
            if (resp.status >= 500 && attempt === 0) {
                lastErr = new Error(`Server error ${resp.status}`);
                continue;
            }
            let data;
            try {
                data = await resp.json();
            }
            catch {
                return { success: false, evaluations: [], error: `Server returned non-JSON response (HTTP ${resp.status})` };
            }
            if (!resp.ok) {
                return { success: false, evaluations: [], error: data.err || `HTTP ${resp.status}` };
            }
            const result = parseEvalResponse(data);
            if (printResults)
                process.stderr.write(formatSummary(result) + '\n');
            return result;
        }
        catch (e) {
            if (e?.name === 'AbortError') {
                return {
                    success: false, evaluations: [],
                    error: `Request timed out after ${HTTP_TIMEOUT / 1000}s. The evaluation may still be running on the server.`,
                };
            }
            if (attempt === 0 && (e?.code === 'ECONNREFUSED' || e?.cause?.code === 'ECONNREFUSED' || e?.message?.includes('fetch failed'))) {
                lastErr = e;
                continue;
            }
            return { success: false, evaluations: [], error: `Cannot connect to OpenLIT server at ${url}: ${e?.message || e}` };
        }
    }
    return { success: false, evaluations: [], error: `Evaluation failed after retries: ${lastErr?.message}` };
}
async function runEvalBatch(options) {
    const { dataset } = options;
    if (!dataset || dataset.length === 0) {
        throw new Error('dataset must be a non-empty array of prompt/response objects');
    }
    for (let i = 0; i < dataset.length; i++) {
        const item = dataset[i];
        if (!item || typeof item !== 'object') {
            throw new TypeError(`dataset[${i}] must be an object`);
        }
        if (!item.prompt || typeof item.prompt !== 'string') {
            throw new Error(`dataset[${i}] must have a 'prompt' string property`);
        }
        if (!item.response || typeof item.response !== 'string') {
            throw new Error(`dataset[${i}] must have a 'response' string property`);
        }
    }
    const runId = options.runId || `batch_${randomHex(12)}`;
    const maxConcurrent = options.maxConcurrent || 5;
    const printResults = options.printResults !== false;
    const results = new Array(dataset.length);
    let cursor = 0;
    async function next() {
        while (cursor < dataset.length) {
            const idx = cursor++;
            const item = dataset[idx];
            try {
                results[idx] = await runEval({
                    prompt: item.prompt,
                    response: item.response,
                    contexts: item.contexts,
                    evalTypes: item.evalTypes ?? options.evalTypes,
                    attributes: item.attributes ?? options.attributes,
                    thresholdScore: item.thresholdScore ?? options.thresholdScore,
                    storeResults: options.storeResults,
                    runId,
                    metadata: item.metadata,
                    openlitApiKey: options.openlitApiKey,
                    openlitUrl: options.openlitUrl,
                    printResults: false,
                });
            }
            catch (e) {
                results[idx] = { success: false, evaluations: [], error: e?.message || String(e) };
            }
        }
    }
    const workers = Array.from({ length: Math.min(maxConcurrent, dataset.length) }, () => next());
    await Promise.all(workers);
    const batch = { results, runId };
    if (printResults)
        process.stderr.write(formatBatchSummary(batch) + '\n');
    return batch;
}
async function fetchEvalTypes(options = {}) {
    const apiKey = resolveApiKey(options.openlitApiKey);
    const url = resolveUrl(options.openlitUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
    try {
        const resp = await fetch(`${url}/api/evaluation/offline/types`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            signal: controller.signal,
        });
        if (resp.status === 401) {
            throw new Error('Authentication failed. Check your OpenLIT API key.');
        }
        if (!resp.ok) {
            throw new Error(`Failed to fetch eval types: HTTP ${resp.status}`);
        }
        const data = await resp.json();
        return (data.eval_types || []).map((t) => ({
            id: t.id || '',
            label: t.label || '',
            description: t.description || '',
            enabled: !!t.enabled,
            isCustom: !!t.is_custom,
        }));
    }
    catch (e) {
        if (e?.name === 'AbortError') {
            throw new Error(`Request timed out after ${HTTP_TIMEOUT / 1000}s`);
        }
        throw e;
    }
    finally {
        clearTimeout(timer);
    }
}
function randomHex(length) {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * 16)];
    }
    return result;
}
//# sourceMappingURL=offline.js.map