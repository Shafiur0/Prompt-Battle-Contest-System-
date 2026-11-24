import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  validatePromptInput, manifestQualified,
  publishedResultVisible, compareLeaderboardRows
} from '../invariants';

// Pure fixtures only: no config.ts, dotenv, credentials, approval files,
// PostgreSQL, Redis, provider requests or production competition data.
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const releaseDigest = sha('isolated test reviewer release');
function approvedManifest(): any {
  const systemEnvelope = 'Isolated test system envelope; no provider call is made.';
  const manifest: any = {
    providerQualified: true,
    generationModel: 'deepseek/deepseek-v4.1-flash-1017',
    qualityModel: 'anthropic/claude-sonnet-5.5',
    reviewerModel: 'anthropic/claude-sonnet-5.5',
    generationProvider: 'FixtureGenerationProvider', reviewProvider: 'FixtureReviewProvider',
    inputUpperBound: 1_048_576, maxOutputTokens: 8192, maxPromptBytes: 64000,
    reviewPackage: 'critical-review-instruction-package-v1', reviewPackageDigest: releaseDigest,
    systemEnvelope
  };
  manifest.qualificationEvidence = {
    status: 'APPROVED', approvedBy: 'isolated-test-reviewer', approvedAt: '2026-11-20T00:00:00.000Z',
    models: { generation: manifest.generationModel, quality: manifest.qualityModel, reviewer: manifest.reviewerModel },
    providers: { generation: manifest.generationProvider, review: manifest.reviewProvider },
    inputUpperBound: manifest.inputUpperBound, maxOutputTokens: manifest.maxOutputTokens,
    maxPromptBytes: manifest.maxPromptBytes, reviewPackage: manifest.reviewPackage,
    reviewPackageDigest: releaseDigest, generationEnvelopeDigest: sha(systemEnvelope),
    allCountedOutputBounded: true, usageRecoveryReviewed: true,
    authoritativeEvidence: ['https://example.invalid/isolated-qualification-fixture'],
    qualityBenchmarkDigest: sha('isolated-quality-benchmark'), reviewerBenchmarkDigest: sha('isolated-reviewer-benchmark'),
    digest: sha('isolated-approval-receipt')
  };
  return manifest;
}

// Prompt admission must share the integrity detector's UTF-8 limit.
test('prompt admission accepts exactly 64000 ASCII bytes', () => {
  const prompt = 'x'.repeat(64000);
  assert.equal(Buffer.byteLength(prompt, 'utf8'), 64000);
  assert.doesNotThrow(() => validatePromptInput(prompt));
});
test('prompt admission rejects 64001 ASCII bytes before generation can strand review', () => {
  assert.throws(() => validatePromptInput('x'.repeat(64001)));
});
test('prompt admission accepts emoji at the exact UTF-8 boundary', () => {
  const prompt = '🧠'.repeat(16000);
  assert.equal(prompt.length, 32000);
  assert.equal(Buffer.byteLength(prompt, 'utf8'), 64000);
  assert.doesNotThrow(() => validatePromptInput(prompt));
});
test('prompt admission measures bytes rather than UTF-16 character length', () => {
  const prompt = '🧠'.repeat(16001);
  assert.ok(prompt.length < 64000);
  assert.equal(Buffer.byteLength(prompt, 'utf8'), 64004);
  assert.throws(() => validatePromptInput(prompt));
});
test('empty or whitespace-only prompts are rejected', () => {
  assert.throws(() => validatePromptInput(''));
  assert.throws(() => validatePromptInput(' \n\t'));
});

test('a complete fixture approval matches its exact frozen manifest and package digest', () => {
  assert.equal(manifestQualified(approvedManifest(), releaseDigest), true);
});
for (const field of ['generationModel', 'qualityModel', 'reviewerModel']) {
  test(`qualification rejects a changed frozen ${field}`, () => {
    const manifest = approvedManifest(); manifest[field] = 'fixture/different-model';
    assert.equal(manifestQualified(manifest, releaseDigest), false);
  });
}
for (const field of ['generationProvider', 'reviewProvider']) {
  test(`qualification rejects a changed frozen ${field}`, () => {
    const manifest = approvedManifest(); manifest[field] = 'DifferentFixtureProvider';
    assert.equal(manifestQualified(manifest, releaseDigest), false);
  });
}
for (const field of ['inputUpperBound', 'maxOutputTokens', 'maxPromptBytes']) {
  test(`qualification rejects a changed frozen ${field}`, () => {
    const manifest = approvedManifest(); manifest[field] += 1;
    assert.equal(manifestQualified(manifest, releaseDigest), false);
  });
}
test('qualification rejects a different review-package name or digest', () => {
  const renamed = approvedManifest(); renamed.reviewPackage = 'different-review-package';
  const changedDigest = approvedManifest(); changedDigest.reviewPackageDigest = sha('different-package');
  assert.equal(manifestQualified(renamed, releaseDigest), false);
  assert.equal(manifestQualified(changedDigest, releaseDigest), false);
});
test('qualification rejects an installed reviewer release differing from the frozen approved release', () => {
  assert.equal(manifestQualified(approvedManifest(), sha('newly-installed-unapproved-package')), false);
});
test('qualification rejects an altered generation envelope', () => {
  const manifest = approvedManifest(); manifest.systemEnvelope = 'Different instructions after approval.';
  assert.equal(manifestQualified(manifest, releaseDigest), false);
});
test('qualification for a new model cannot approve an old frozen model', () => {
  const manifest = approvedManifest();
  manifest.qualificationEvidence.models.generation = 'fixture/new-model';
  manifest.qualificationEvidence.digest = sha('approval for a different model');
  assert.equal(manifestQualified(manifest, releaseDigest), false);
});
test('missing, unapproved or incomplete qualification cannot authorize official results', () => {
  const absent = approvedManifest(); absent.qualificationEvidence = null;
  const unapproved = approvedManifest(); unapproved.qualificationEvidence.status = 'DRAFT';
  const unchecked = approvedManifest(); unchecked.providerQualified = false;
  const unbounded = approvedManifest(); unbounded.qualificationEvidence.allCountedOutputBounded = false;
  const unrecoverable = approvedManifest(); unrecoverable.qualificationEvidence.usageRecoveryReviewed = false;
  for (const manifest of [absent, unapproved, unchecked, unbounded, unrecoverable]) assert.equal(manifestQualified(manifest, releaseDigest), false);
});
test('qualification requires valid benchmark/approval evidence metadata', () => {
  const invalidBenchmark = approvedManifest(); invalidBenchmark.qualificationEvidence.reviewerBenchmarkDigest = 'not-a-digest';
  const noEvidence = approvedManifest(); noEvidence.qualificationEvidence.authoritativeEvidence = [];
  const noReviewer = approvedManifest(); noReviewer.qualificationEvidence.approvedBy = '';
  for (const manifest of [invalidBenchmark, noEvidence, noReviewer]) assert.equal(manifestQualified(manifest, releaseDigest), false);
});

const decision = '11111111-1111-4111-8111-111111111111';
const differentDecision = '22222222-2222-4222-8222-222222222222';
test('revealed finalized results are visible only with the exact effective decision', () => {
  assert.equal(publishedResultVisible('REVEALED', 'FINALIZED', decision, decision), true);
  assert.equal(publishedResultVisible('CALIBRATION_REVEALED', 'FINALIZED', decision, decision), true);
});
test('unrevealed competition never exposes a finalized private score', () => {
  for (const status of ['DRAFT', 'GENERATION_OPEN', 'CLOSED']) assert.equal(publishedResultVisible(status, 'FINALIZED', decision, decision), false);
});
test('processing or inconclusive successor decisions hide stale published results', () => {
  for (const state of ['PROCESSING', 'SEALING', 'PENDING', 'INSUFFICIENT_EVIDENCE']) assert.equal(publishedResultVisible('REVEALED', state, decision, decision), false);
});
test('a score tied to a different human decision is hidden after reveal', () => {
  assert.equal(publishedResultVisible('REVEALED', 'FINALIZED', decision, differentDecision), false);
});
test('absent decision identities never pass a null-equality publication gate', () => {
  assert.equal(publishedResultVisible('REVEALED', 'FINALIZED', null, null), false);
  assert.equal(publishedResultVisible('REVEALED', 'FINALIZED', undefined, undefined), false);
  assert.equal(publishedResultVisible('REVEALED', 'FINALIZED', decision, null), false);
  assert.equal(publishedResultVisible('REVEALED', 'FINALIZED', null, decision), false);
});

function row(overrides: Record<string, unknown> = {}, consumed: number | string = 50000): any {
  return { score: { eligible: true, finalScore: 80, quality: 0.9, correctness: 1, ...overrides }, consumed };
}
test('leaderboard sorts eligible final results before higher-scoring ineligible results', () => {
  assert.ok(compareLeaderboardRows(row({ eligible: true, finalScore: 50 }), row({ eligible: false, finalScore: 100 })) < 0);
});
test('leaderboard compares score before quality', () => {
  assert.ok(compareLeaderboardRows(row({ finalScore: 81, quality: 0.7 }), row({ finalScore: 80, quality: 1 })) < 0);
});
test('leaderboard compares quality after equal final score', () => {
  assert.ok(compareLeaderboardRows(row({ quality: 0.95 }), row({ quality: 0.9 })) < 0);
});
test('leaderboard compares correctness before tokens when score and quality tie', () => {
  assert.ok(compareLeaderboardRows(row({ correctness: 1 }, 150000), row({ correctness: 0.7 }, 10000)) < 0);
});
test('leaderboard compares audited token quantities numerically including PostgreSQL bigint strings', () => {
  assert.ok(compareLeaderboardRows(row({}, '50000'), row({}, '150000')) < 0);
});
test('identical published ranking keys share a rank without alias or insertion-order tie breakers', () => {
  const a = { ...row(), alias: 'Alpha' }, b = { ...row(), alias: 'Beta' };
  assert.equal(compareLeaderboardRows(a, b), 0);
  assert.equal(compareLeaderboardRows(b, a), 0);
});
test('pending results sort behind finalized results even when their token total is smaller', () => {
  const finalized = row({ eligible: false, finalScore: 0, quality: 0, correctness: 0 }, 50000);
  const pending = { score: null, consumed: 0 };
  assert.ok(compareLeaderboardRows(finalized, pending) < 0);
});