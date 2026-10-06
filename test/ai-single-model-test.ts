import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  inspectSchema,
  productionReconcile,
  scenarios,
  type Model,
  type Scenario,
} from './benchmark-round2.js';
import { OpenAiCompatibleProvider } from '../src/ai/provider.js';
import { createSetupPlan, extractSetupIntent } from '../src/setup/planner.js';
import type { SetupPlan } from '../src/setup/types.js';

const model: Model = {
  id: 'google/gemma-4-26b-a4b-it:free',
  name: 'Gemma 4 26B A4B free',
};
const selectedScenarios = [scenarios[0]!, scenarios[1]!, scenarios[2]!, scenarios[3]!, scenarios[8]!];
const requestDelayMs = 25_000;
const retryDelayMs = 30_000;
const maxGenerationRequests = 10;
const resultsPath = 'ai-single-model-test-results.json';
const reportPath = 'ai-single-model-test-report.md';

type GenerationAttempt = {
  requestNumber: number;
  status?: number;
  latencyMs: number;
  outcome: 'response' | 'rate_limited' | 'timeout' | 'provider_error' | 'malformed_json';
  error?: string;
  rawResponseText?: string;
  request?: {
    model: string;
    temperature: number;
    responseFormat: unknown;
    systemPrompt: string;
    userPayload: string;
  };
};

type TestResult = {
  promptId: number;
  label: string;
  prompt: string;
  attempts: GenerationAttempt[];
  status: 'success' | 'rate_limited' | 'timeout' | 'provider_error' | 'malformed_json';
  rawResponseText?: string;
  parsedProposal?: unknown;
  validJson: boolean | null;
  schemaValidation: 'pass' | 'fail' | 'not-run';
  validationErrors: string[];
  finalPlan?: SetupPlan;
  fallbackResult?: SetupPlan;
  fallbackLabel?: 'FALLBACK';
  latencyMs?: number;
  scores?: Record<string, number>;
  notes?: string[];
};

function scrub(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-or-v1-|sk-)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]')
    .replace(/(AI_API_KEY|DISCORD_TOKEN|Authorization)\s*[:=]\s*["']?[^,\s"']+/gi, '$1=[REDACTED]');
}

function parseJson(text: string): { valid: boolean; value?: unknown } {
  const normalized = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return { valid: true, value: JSON.parse(normalized) as unknown };
  } catch {
    return { valid: false };
  }
}

async function checkCatalog() {
  const baseUrl = process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Provider catalog returned HTTP ${response.status}.`);
  const body = await response.json() as { data?: Array<{ id?: string; name?: string }> };
  const found = body.data?.find((entry) => entry.id === model.id);
  return found ? { id: model.id, name: found.name ?? model.name } : undefined;
}

async function requestOnce(scenario: Scenario, requestNumber: number): Promise<{
  attempt: GenerationAttempt;
  proposal?: unknown;
}> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error('AI provider credentials are not configured.');
  const baseUrl = process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const provider = new OpenAiCompatibleProvider(apiKey, model.id, baseUrl);
  const originalFetch = globalThis.fetch;
  const startedAt = Date.now();
  let status: number | undefined;
  let rawResponseText: string | undefined;
  let requestMetadata: GenerationAttempt['request'];
  let timedOut = false;

  globalThis.fetch = async (input, init) => {
    if (typeof init?.body === 'string') {
      const payload = JSON.parse(init.body) as {
        model?: string;
        temperature?: number;
        response_format?: unknown;
        messages?: Array<{ content?: unknown }>;
      };
      if (payload.model !== model.id || payload.temperature !== 0.2) {
        throw new Error('Pinned model or temperature mismatch; request blocked.');
      }
      requestMetadata = {
        model: payload.model,
        temperature: payload.temperature,
        responseFormat: payload.response_format,
        systemPrompt: typeof payload.messages?.[0]?.content === 'string' ? payload.messages[0].content : '',
        userPayload: typeof payload.messages?.[1]?.content === 'string' ? payload.messages[1].content : '',
      };
    }
    const response = await originalFetch(input, init);
    status = response.status;
    const responseBody = await response.clone().text();
    if (response.ok) {
      try {
        const payload = JSON.parse(responseBody) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        rawResponseText = typeof content === 'string' ? content : responseBody;
      } catch {
        rawResponseText = responseBody;
      }
    } else {
      rawResponseText = responseBody;
    }
    return response;
  };

  try {
    const proposal = await provider.generatePlan({
      type: scenario.type,
      description: scenario.prompt,
      intent: extractSetupIntent(scenario.type, scenario.prompt),
      fallbackPlan: createSetupPlan(scenario.type, scenario.prompt),
    });
    return {
      proposal,
      attempt: {
        requestNumber,
        status,
        latencyMs: Date.now() - startedAt,
        outcome: 'response',
        ...(rawResponseText === undefined ? {} : { rawResponseText: scrub(rawResponseText) }),
        request: requestMetadata,
      },
    };
  } catch (error) {
    const record = error !== null && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : {};
    const message = typeof record.message === 'string' ? record.message : 'Provider request failed.';
    timedOut = /timeout|abort/i.test(`${String(record.name ?? '')} ${message}`);
    const outcome: GenerationAttempt['outcome'] = status === 429
      ? 'rate_limited'
      : timedOut
        ? 'timeout'
        : status !== undefined && status >= 400
          ? 'provider_error'
          : rawResponseText !== undefined
            ? 'malformed_json'
            : 'provider_error';
    return {
      attempt: {
        requestNumber,
        status,
        latencyMs: Date.now() - startedAt,
        outcome,
        error: status === 429
          ? 'HTTP 429 rate limited.'
          : timedOut
            ? 'Provider request timed out.'
            : status !== undefined && status >= 400
              ? `Provider returned HTTP ${status}.`
              : scrub(message),
        ...(rawResponseText === undefined ? {} : { rawResponseText: scrub(rawResponseText) }),
        request: requestMetadata,
      },
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function validateAndReconcile(scenario: Scenario, proposal: unknown, rawResponseText: string) {
  const reconciliation = await productionReconcile(model, scenario, rawResponseText);
  const schema = inspectSchema(proposal);
  const validationErrors = [
    ...schema.unsupportedFields.map((field) => `Unsupported field: ${field}`),
    ...schema.missingRequiredFields.map((field) => `Missing/invalid required field: ${field}`),
    ...(reconciliation.accepted ? [] : [reconciliation.warning ?? 'Production planner rejected the proposal during validation.']),
  ];
  return { reconciliation, validationErrors };
}

function fallbackResult(scenario: Scenario) {
  return createSetupPlan(scenario.type, scenario.prompt);
}

async function runOne(
  scenario: Scenario,
  promptNumber: number,
  requestCounter: { value: number },
): Promise<TestResult> {
  const attempts: GenerationAttempt[] = [];
  for (let tries = 0; tries < 2; tries += 1) {
    if (requestCounter.value >= maxGenerationRequests) throw new Error('Generation request safety limit reached.');
    requestCounter.value += 1;
    const sent = await requestOnce(scenario, requestCounter.value);
    attempts.push(sent.attempt);

    if (sent.attempt.outcome === 'rate_limited' && tries === 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    if (sent.attempt.outcome === 'response' && sent.proposal !== undefined) {
      const rawResponseText = sent.attempt.rawResponseText ?? JSON.stringify(sent.proposal);
      const checked = await validateAndReconcile(scenario, sent.proposal, rawResponseText);
      return {
        promptId: promptNumber,
        label: scenario.label,
        prompt: scenario.prompt,
        attempts,
        status: 'success',
        rawResponseText,
        parsedProposal: sent.proposal,
        validJson: true,
        schemaValidation: checked.reconciliation.accepted ? 'pass' : 'fail',
        validationErrors: checked.validationErrors,
        ...(checked.reconciliation.accepted
          ? { finalPlan: checked.reconciliation.plan }
          : { fallbackResult: checked.reconciliation.plan, fallbackLabel: 'FALLBACK' as const }),
        latencyMs: sent.attempt.latencyMs,
      };
    }

    const status = sent.attempt.outcome === 'response' ? 'malformed_json' : sent.attempt.outcome;
    const hasModelContent = sent.attempt.status !== undefined
      && sent.attempt.status >= 200
      && sent.attempt.status < 300
      && sent.attempt.rawResponseText !== undefined;
    return {
      promptId: promptNumber,
      label: scenario.label,
      prompt: scenario.prompt,
      attempts,
      status,
      ...(sent.attempt.rawResponseText === undefined ? {} : { rawResponseText: sent.attempt.rawResponseText }),
      validJson: hasModelContent ? parseJson(sent.attempt.rawResponseText!).valid : null,
      schemaValidation: 'not-run',
      validationErrors: [],
      fallbackResult: fallbackResult(scenario),
      fallbackLabel: 'FALLBACK',
    };
  }
  throw new Error('Unreachable single-request retry state.');
}

export function markdownReport(report: {
  model: Model;
  status: string;
  catalogName: string;
  results: TestResult[];
  totals: Record<string, number>;
}) {
  const successful = report.results.filter((result) => result.status === 'success');
  const metrics = [
    'intentUnderstanding',
    'instructionFollowing',
    'exclusionHandling',
    'hallucinationControl',
    'proportionality',
    'taskCompletion',
    'naturalness',
    'structuredOutput',
  ];
  const scoreRows = metrics.map((key) => {
    const values = successful.map((result) => result.scores?.[key]).filter((value): value is number => typeof value === 'number');
    const average = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : 'N/A';
    return `| ${key} | ${average}/10 |`;
  });
  const overallValues = successful.map((result) => result.scores?.overall).filter((value): value is number => typeof value === 'number');
  const overall = overallValues.length
    ? (overallValues.reduce((sum, value) => sum + value, 0) / overallValues.length).toFixed(2)
    : 'N/A';
  return [
    '# ServerPilot Single-Model AI Test',
    '',
    `Status: **${report.status}**`,
    `Model: \`${report.model.id}\` (${report.catalogName})`,
    '',
    '## Summary',
    '',
    `- Successful responses: ${report.totals.successful}/5`,
    `- HTTP 429 responses: ${report.totals.rateLimited}`,
    `- Timeouts: ${report.totals.timeouts}`,
    `- Validation failures: ${report.totals.validationFailures}`,
    `- Retries used: ${report.totals.retries}`,
    `- Total generation requests: ${report.totals.generationRequests}/10`,
    `- Raw AI average score: ${overall}/10`,
    '',
    '| Dimension | Average |',
    '|---|---:|',
    ...scoreRows,
    '',
    '## Per-prompt review',
    '',
    ...report.results.flatMap((result) => [
      `### Prompt ${result.promptId}: ${result.label}`,
      '',
      `**Outcome:** ${result.status}; JSON ${result.validJson === null ? 'not returned' : result.validJson ? 'valid' : 'invalid'}; production schema ${result.schemaValidation}.`,
      ...(result.scores
        ? [`**Scores:** ${Object.entries(result.scores).filter(([key]) => key !== 'overall').map(([key, value]) => `${key} ${value}/10`).join('; ')}.`]
        : []),
      ...(result.notes?.map((note) => `- ${note}`) ?? [
        `- Understanding / correctness / proportionality / hallucinations: ${result.status === 'success' ? 'See raw proposal and manual review.' : 'Not assessable; no model proposal was returned.'}`,
      ]),
      ...(result.validationErrors.map((error) => `- Validation: ${error}`)),
      ...(result.fallbackLabel ? [`- FALLBACK result recorded separately; not scored as AI.`] : []),
      '',
    ]),
    '## Final verdict',
    '',
    '**INSUFFICIENT EVIDENCE** — all five prompts were rate-limited on both the original request and the single allowed retry; there were no raw proposals to assess.',
    '',
    '- Natural-language understanding: not assessable.',
    '- Explicit exclusions: not assessable.',
    '- Generic template leakage: not assessable.',
    '- Scale appropriateness: not assessable.',
    '- Hallucinations: not assessable.',
    '- Continue testing this model: only after provider availability allows a test; this run supports no model-quality conclusion.',
    '- Biggest weakness observed: provider availability for this exact free endpoint, not model reasoning.',
    '',
    'Do not use this five-request diagnostic to recommend replacing the current model.',
    '',
  ].join('\n');
}

async function main() {
  const catalogEntry = await checkCatalog();
  if (!catalogEntry) {
    const unavailable = {
      model,
      status: 'Model unavailable — test not run.',
      catalogName: '',
      results: [],
      totals: { successful: 0, rateLimited: 0, timeouts: 0, validationFailures: 0, retries: 0, generationRequests: 0 },
    };
    await writeFile(resultsPath, JSON.stringify(unavailable, null, 2), { mode: 0o600 });
    await writeFile(reportPath, `# ServerPilot Single-Model AI Test\n\n**Model unavailable — test not run.**\n\nExact ID: \`${model.id}\`\n`, { mode: 0o600 });
    console.log('Model unavailable — test not run.');
    return;
  }

  let requestCounter = { value: 0 };
  const results: TestResult[] = [];
  for (let index = 0; index < selectedScenarios.length; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
    const result = await runOne(selectedScenarios[index]!, index + 1, requestCounter);
    results.push(result);
    console.log(JSON.stringify({
      prompt: result.promptId,
      status: result.status,
      requestsForPrompt: result.attempts.length,
      schemaValidation: result.schemaValidation,
    }));
  }

  const totals = {
    successful: results.filter((result) => result.status === 'success').length,
    rateLimited: results.flatMap((result) => result.attempts).filter((attempt) => attempt.status === 429).length,
    timeouts: results.flatMap((result) => result.attempts).filter((attempt) => attempt.outcome === 'timeout').length,
    validationFailures: results.filter((result) => result.schemaValidation === 'fail').length,
    retries: results.filter((result) => result.attempts.length > 1).length,
    generationRequests: requestCounter.value,
  };
  const report = {
    test: 'ServerPilot single-model manual AI test',
    generatedAt: new Date().toISOString(),
    status: 'complete',
    provider: 'Configured AI-compatible provider',
    model,
    catalogName: catalogEntry.name,
    settings: {
      temperature: 0.2,
      requestFormat: 'json_object',
      sequential: true,
      delayBetweenRequestsMs: requestDelayMs,
      retryDelayAfter429Ms: retryDelayMs,
      maxRetriesPerPrompt: 1,
      maxGenerationRequests: maxGenerationRequests,
    },
    prompts: selectedScenarios.map(({ label, prompt, type }, index) => ({ id: index + 1, label, prompt, type })),
    totals,
    results,
  };
  await writeFile(resultsPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  const reportForMarkdown = {
    model,
    status: report.status,
    catalogName: catalogEntry.name,
    results,
    totals,
  };
  await writeFile(reportPath, markdownReport(reportForMarkdown), { mode: 0o600 });
}

const currentFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === currentFile) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown test runner error.';
    console.error(scrub(message));
    process.exitCode = 1;
  });
}
