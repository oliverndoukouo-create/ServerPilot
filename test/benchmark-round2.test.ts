import assert from 'node:assert/strict';
import test from 'node:test';
import {
  minimumRankableValidResponses,
  markdownDestinationFor,
  markdownReport,
  jsonReport,
  models,
  requestDelayMs,
  modelDelayMs,
  resolveCatalogModels,
  runSmokeTest,
  scenarios,
  taskSequence,
  inspectSchema,
} from './benchmark-round2.js';

test('Round 2 has the exact ten prompt schedule and repeated prompt counts', () => {
  const sequence = taskSequence();
  assert.equal(scenarios.length, 10);
  assert.equal(sequence.length, 20);
  for (const id of [1, 2, 5, 8, 10]) {
    assert.equal(sequence.filter((item) => item.scenario.id === id).length, 3);
  }
  for (const id of [3, 4, 6, 7, 9]) {
    assert.equal(sequence.filter((item) => item.scenario.id === id).length, 1);
  }
  assert.equal(requestDelayMs, 12_000);
  assert.equal(modelDelayMs, 30_000);
  assert.equal(minimumRankableValidResponses, 15);
});

test('exact model catalog matching never substitutes a different pinned ID', () => {
  const catalog = models.filter((model) => model.id !== 'nvidia/nemotron-3-ultra:free')
    .map((model) => ({ id: model.id, name: model.name }));
  catalog.push({ id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Different Nemotron Ultra endpoint' });
  const result = resolveCatalogModels(catalog);
  assert.equal(result.available.length, 4);
  assert.ok(result.unavailable.some((model) =>
    model.id === 'nvidia/nemotron-3-ultra:free' && model.reason.includes('no substitute')));
  assert.ok(!result.available.some((model) => model.id.includes('nemotron-3-ultra')));
  assert.ok(result.available.some((model) => model.id === 'dots-studio/dots-3-note-preview:free'));
});

test('Round 2 writes the requested report name beside the results JSON', () => {
  assert.equal(
    markdownDestinationFor('ai-model-benchmark-round2-results.json'),
    'ai-model-benchmark-round2-report.md',
  );
  assert.equal(markdownDestinationFor('custom.json'), 'custom.md');
});

test('Markdown report records unavailable pinned model IDs and reasons', () => {
  const report = jsonReport([], resolveCatalogModels([]));
  const markdown = markdownReport(report);
  assert.match(markdown, /nvidia\/nemotron-3-ultra:free/);
  assert.match(markdown, /Exact pinned model ID is absent/);
});

test('schema diagnostics report missing and unsupported fields without rewriting proposals', () => {
  const diagnostics = inspectSchema({
    type: 'Gaming',
    description: 'test',
    categories: [{ name: 'General', channels: [], generatedBy: 'model' }],
    unexpected: true,
  });
  assert.ok(diagnostics.unsupportedFields.includes('unexpected'));
  assert.ok(diagnostics.unsupportedFields.includes('categories[0].generatedBy'));
  assert.ok(diagnostics.missingRequiredFields.includes('voiceCategories'));
});

test('offline smoke test verifies sequencing, timing, failure classes, raw/final capture, and reconciliation', async () => {
  const result = await runSmokeTest();
  assert.equal(result.passed, true);
  assert.equal(result.requestsSentToProvider, 0);
  assert.equal(result.maximumConcurrentRequests, 1);
  assert.equal(result.recordsRawAndFinalSeparately, true);
  assert.equal(result.records429AndTimeoutSeparately, true);
  assert.equal(result.recordsMalformedJsonAndValidationFallback, true);
  assert.equal(result.preservesRawResponseText, true);
  assert.equal(result.usesProductionReconciliation, true);
  assert.equal(result.delaysVerified.request, 12_000);
  assert.equal(result.delaysVerified.models, 30_000);
});
