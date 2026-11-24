import { createHash } from 'node:crypto';
import type { CopyDetectionReport, CopyMatch, CriticalRegistry, MatchMethod, RegistryItem, TextRange } from './types';
import { stableUuid } from './sample';

export const NORMALIZER_VERSION = 'nfc-whitespace-utf8-map-v1';
export const MAX_PROMPT_BYTES = 64_000;
const MAX_MATCHES = 2000;
const MAX_PARTIAL_PAIRS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
export function hashText(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }
export function isUtf8Boundary(text: string, position: number): boolean {
  const bytes = Buffer.from(text, 'utf8');
  return Number.isSafeInteger(position) && position >= 0 && position <= bytes.length && (position === bytes.length || (bytes[position] & 0xc0) !== 0x80);
}
export function verifyTextRange(text: string, range: TextRange): void {
  if (!isUtf8Boundary(text, range.startByte) || !isUtf8Boundary(text, range.endByte) || range.startByte >= range.endByte) throw new Error('Invalid UTF-8 evidence range');
  if (Buffer.from(text, 'utf8').subarray(range.startByte, range.endByte).toString('utf8') !== range.quote) throw new Error('Evidence quote does not equal the original source bytes');
}
export function validateRegistry(registry: CriticalRegistry): void {
  for (const id of [registry.id, registry.versionId, registry.policyVersionId]) if (!isUuid(id)) throw new Error('Registry identities must be UUIDs');
  if (typeof registry.sourceText !== 'string' || Buffer.byteLength(registry.sourceText) > 256_000) throw new Error('Registry source is missing or exceeds its limit');
  if (!Number.isSafeInteger(registry.partialMinCodePoints) || registry.partialMinCodePoints < 16 || registry.partialMinCodePoints > 128) throw new Error('Invalid frozen partial-match threshold');
  if (!Array.isArray(registry.items) || registry.items.length > 100) throw new Error('Registry item limit exceeded');
  const ids = new Set<string>();
  const known = new Set(['PROTECTED_CRITICAL_INFORMATION', 'ALLOWED_PUBLIC_INFORMATION', 'REQUIRED_INFORMATION', 'PRIVATE_EVALUATION_CRITERIA']);
  for (const item of registry.items) {
    if (!isUuid(item.id) || ids.has(item.id)) throw new Error('Registry item identities must be unique UUIDs');
    ids.add(item.id);
    if (!known.has(item.category)) throw new Error('Unknown information category');
    if (item.category === 'PRIVATE_EVALUATION_CRITERIA') {
      if (item.text !== undefined || item.sourceStartByte !== undefined || item.sourceEndByte !== undefined || item.publicRuleId !== undefined) throw new Error('Private criteria are references, not copying sources');
      continue;
    }
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 10_000) throw new Error('Public registry items require nonempty bounded text');
    verifyTextRange(registry.sourceText, { startByte: item.sourceStartByte!, endByte: item.sourceEndByte!, quote: item.text });
    if (item.category === 'PROTECTED_CRITICAL_INFORMATION' && (typeof item.publicRuleId !== 'string' || !item.publicRuleId.trim())) throw new Error('Protected public passages require a published rule');
    if (item.category !== 'PROTECTED_CRITICAL_INFORMATION' && item.severity && item.severity !== 'NONE') throw new Error('Allowed or required facts cannot carry copying severity');
  }
  const protectedItems = registry.items.filter(i => i.category === 'PROTECTED_CRITICAL_INFORMATION');
  const permitted = registry.items.filter(i => i.category === 'REQUIRED_INFORMATION' || i.category === 'ALLOWED_PUBLIC_INFORMATION');
  for (const p of protectedItems) for (const a of permitted) {
    if (Math.max(p.sourceStartByte!, a.sourceStartByte!) < Math.min(p.sourceEndByte!, a.sourceEndByte!)) throw new Error('Protected source ranges cannot conflict with allowed or required source ranges');
  }
}

interface Unit { char: string; startByte: number; endByte: number }
interface View { units: Unit[]; text: string; utf16Starts: number[] }
function view(text: string, compatibility = false): View {
  const byteAt = new Map<number, number>([[0, 0]]);
  let utf16 = 0, byte = 0;
  for (const char of text) { utf16 += char.length; byte += Buffer.byteLength(char); byteAt.set(utf16, byte); }
  const units: Unit[] = [];
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  for (const segment of segmenter.segment(text)) {
    const startByte = byteAt.get(segment.index)!;
    const endByte = byteAt.get(segment.index + segment.segment.length)!;
    let transformed = segment.segment.normalize(compatibility ? 'NFKC' : 'NFC');
    if (compatibility) transformed = transformed.toLowerCase().replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/gu, '').replace(/[“”]/gu, '"').replace(/[‘’]/gu, "'");
    for (const rawChar of transformed) {
      const char = /\p{White_Space}/u.test(rawChar) ? ' ' : rawChar;
      if (char === ' ' && units.at(-1)?.char === ' ') units[units.length - 1].endByte = endByte;
      else units.push({ char, startByte, endByte });
    }
  }
  const utf16Starts: number[] = []; let cursor = 0;
  for (const unit of units) { utf16Starts.push(cursor); cursor += unit.char.length; }
  utf16Starts.push(cursor);
  return { units, text: units.map(u => u.char).join(''), utf16Starts };
}
function unitAt(v: View, index: number): number {
  let left = 0, right = v.utf16Starts.length - 1;
  while (left < right) { const mid = Math.floor((left + right) / 2); if (v.utf16Starts[mid] < index) left = mid + 1; else right = mid; }
  return left;
}
function fromUnits(original: string, units: Unit[], start: number, end: number, offset = 0): TextRange {
  const startByte = units[start].startByte + offset;
  const endByte = units[end - 1].endByte + offset;
  return { startByte, endByte, quote: Buffer.from(original, 'utf8').subarray(startByte, endByte).toString('utf8') };
}
function plainRange(text: string, utf16Start: number, utf16End: number): TextRange {
  return { startByte: Buffer.byteLength(text.slice(0, utf16Start)), endByte: Buffer.byteLength(text.slice(0, utf16End)), quote: text.slice(utf16Start, utf16End) };
}
function isWordChar(char: string | undefined): boolean { return !!char && /[\p{L}\p{N}_]/u.test(char); }
function boundaryMatch(haystack: string, start: number, needle: string): boolean {
  return !(isWordChar(needle[0]) && isWordChar(haystack[start - 1])) && !(isWordChar(needle.at(-1)) && isWordChar(haystack[start + needle.length]));
}
function allOccurrences(haystack: string, needle: string, wordBoundary = false): number[] {
  const indices: number[] = [];
  if (!needle) return indices;
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found < 0) break;
    if (!wordBoundary || boundaryMatch(haystack, found, needle)) indices.push(found);
    cursor = found + 1;
    if (indices.length > MAX_MATCHES) break;
  }
  return indices;
}
function intersects(a: TextRange, b: TextRange): boolean { return Math.max(a.startByte, b.startByte) < Math.min(a.endByte, b.endByte); }
function unitMask(units: Unit[], ranges: TextRange[]): Set<number> {
  const mask = new Set<number>();
  for (let index = 0; index < units.length; index++) {
    const u = units[index];
    if (u.char !== ' ' && ranges.some(r => Math.max(u.startByte, r.startByte) < Math.min(u.endByte, r.endByte))) mask.add(index);
  }
  return mask;
}

export function detectProtectedCopy(prompt: string, registry: CriticalRegistry): CopyDetectionReport {
  validateRegistry(registry);
  if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new Error(`Prompt must be at most ${MAX_PROMPT_BYTES} UTF-8 bytes`);
  if (Buffer.from(prompt, 'utf8').toString('utf8') !== prompt) throw new Error('Prompt must contain valid Unicode scalar text');
  const canonical = view(prompt), secondary = view(prompt, true);
  const promptHash = hashText(prompt);
  const matches: CopyMatch[] = [], allowedMatches: CopyMatch[] = [];
  const seen = new Set<string>();
  let coverageComplete = true;
  const add = (item: RegistryItem, method: MatchMethod, promptRange: TextRange, sourceRange: TextRange, exempt = false) => {
    const key = `${item.id}:${promptRange.startByte}:${promptRange.endByte}:${sourceRange.startByte}:${sourceRange.endByte}`;
    if (seen.has(key)) return;
    if (matches.length + allowedMatches.length >= MAX_MATCHES) { coverageComplete = false; return; }
    seen.add(key);
    verifyTextRange(prompt, promptRange); verifyTextRange(registry.sourceText, sourceRange);
    const match: CopyMatch = {
      id: stableUuid(`evidence:${promptHash}:${registry.versionId}:${key}`), itemId: item.id, method,
      promptRange, sourceRange, sourceCoverage: 0, exempt
    };
    (exempt ? allowedMatches : matches).push(match);
  };
  const publicItems = registry.items.filter(i => i.category !== 'PRIVATE_EVALUATION_CRITERIA');
  for (const item of publicItems) {
    const protectedItem = item.category === 'PROTECTED_CRITICAL_INFORMATION';
    const sourceRange = { startByte: item.sourceStartByte!, endByte: item.sourceEndByte!, quote: item.text! };
    const rawHits = allOccurrences(prompt, item.text!, !protectedItem);
    if (rawHits.length > MAX_MATCHES) coverageComplete = false;
    for (const index of rawHits) add(item, 'EXACT', plainRange(prompt, index, index + item.text!.length), sourceRange, !protectedItem);
    const needle = view(item.text!);
    for (const index of allOccurrences(canonical.text, needle.text, !protectedItem)) {
      add(item, 'NORMALIZED', fromUnits(prompt, canonical.units, unitAt(canonical, index), unitAt(canonical, index + needle.text.length)), sourceRange, !protectedItem);
    }
    const compatNeedle = view(item.text!, true);
    for (const index of allOccurrences(secondary.text, compatNeedle.text, !protectedItem)) {
      add(item, 'COMPATIBILITY_CANDIDATE', fromUnits(prompt, secondary.units, unitAt(secondary, index), unitAt(secondary, index + compatNeedle.text.length)), sourceRange, !protectedItem);
    }
  }
  const promptCompact = canonical.units.filter(u => u.char !== ' ');
  const seed = registry.partialMinCodePoints;
  const gramMap = new Map<string, number[]>();
  for (let index = 0; index + seed <= promptCompact.length; index++) {
    const key = promptCompact.slice(index, index + seed).map(u => u.char).join('');
    const existing = gramMap.get(key); if (existing) existing.push(index); else gramMap.set(key, [index]);
  }
  let pairs = 0;
  for (const item of publicItems.filter(i => i.category === 'PROTECTED_CRITICAL_INFORMATION')) {
    const source = view(item.text!).units.filter(u => u.char !== ' ');
    for (let start = 0; start + seed <= source.length; start++) {
      const gram = source.slice(start, start + seed).map(u => u.char).join('');
      for (const p of gramMap.get(gram) ?? []) {
        if (++pairs > MAX_PARTIAL_PAIRS) { coverageComplete = false; break; }
        let sLeft = start, pLeft = p, sRight = start + seed, pRight = p + seed;
        while (sLeft > 0 && pLeft > 0 && source[sLeft - 1].char === promptCompact[pLeft - 1].char) { sLeft--; pLeft--; }
        while (sRight < source.length && pRight < promptCompact.length && source[sRight].char === promptCompact[pRight].char) { sRight++; pRight++; }
        const pRange = fromUnits(prompt, promptCompact, pLeft, pRight);
        const sRange = fromUnits(registry.sourceText, source, sLeft, sRight, item.sourceStartByte!);
        const already = matches.some(m => m.itemId === item.id && m.promptRange.startByte <= pRange.startByte && m.promptRange.endByte >= pRange.endByte && m.sourceRange.startByte <= sRange.startByte && m.sourceRange.endByte >= sRange.endByte);
        if (!already) add(item, 'PARTIAL', pRange, sRange);
      }
      if (pairs > MAX_PARTIAL_PAIRS) break;
    }
    if (pairs > MAX_PARTIAL_PAIRS) break;
  }
  const exemptionMask = unitMask(canonical.units, allowedMatches.map(m => m.promptRange));
  const protectedMask = unitMask(canonical.units, matches.map(m => m.promptRange));
  for (const index of exemptionMask) protectedMask.delete(index);
  const denominator = canonical.units.filter(u => u.char !== ' ').length;
  const sourceCoverage: Record<string, number> = {};
  for (const item of publicItems.filter(i => i.category === 'PROTECTED_CRITICAL_INFORMATION')) {
    const sourceView = view(item.text!);
    const matchingRanges = matches.filter(m => m.itemId === item.id).map(m => ({ ...m.sourceRange, startByte: m.sourceRange.startByte - item.sourceStartByte!, endByte: m.sourceRange.endByte - item.sourceStartByte! }));
    const sourceMask = unitMask(sourceView.units, matchingRanges);
    const sourceExemptions: TextRange[] = [];
    for (const allowed of publicItems.filter(i => i.category !== 'PROTECTED_CRITICAL_INFORMATION')) {
      for (const index of allOccurrences(sourceView.text, view(allowed.text!).text, true)) sourceExemptions.push(fromUnits(item.text!, sourceView.units, unitAt(sourceView, index), unitAt(sourceView, index + view(allowed.text!).text.length)));
    }
    const excluded = unitMask(sourceView.units, sourceExemptions);
    for (const index of excluded) sourceMask.delete(index);
    const eligibleDenominator = sourceView.units.filter((u, i) => u.char !== ' ' && !excluded.has(i)).length;
    sourceCoverage[item.id] = eligibleDenominator ? sourceMask.size / eligibleDenominator : 0;
    for (const match of matches.filter(m => m.itemId === item.id)) match.sourceCoverage = sourceCoverage[item.id];
  }
  // Context evidence covers the full prompt even when literal candidates are absent.
  // Each chunk is tied to a known protected source item; AI may cite these IDs but cannot invent ranges.
  const contextEvidence: CopyMatch[] = [];
  const byteBuffer = Buffer.from(prompt);
  const chunks: TextRange[] = [];
  for (let start = 0; start < byteBuffer.length;) {
    let end = Math.min(start + 1600, byteBuffer.length);
    while (end > start && !isUtf8Boundary(prompt, end)) end--;
    if (end === start) throw new Error('Cannot form a valid context chunk');
    chunks.push({ startByte: start, endByte: end, quote: byteBuffer.subarray(start, end).toString('utf8') }); start = end;
  }
  for (const item of publicItems.filter(i => i.category === 'PROTECTED_CRITICAL_INFORMATION')) for (const range of chunks) {
    contextEvidence.push({
      id: stableUuid(`context:${promptHash}:${registry.versionId}:${item.id}:${range.startByte}:${range.endByte}`),
      itemId: item.id, method: 'CONTEXT', promptRange: range,
      sourceRange: { startByte: item.sourceStartByte!, endByte: item.sourceEndByte!, quote: item.text! },
      sourceCoverage: 0, exempt: false
    });
  }
  return { promptHash, registryVersionId: registry.versionId, normalizerVersion: NORMALIZER_VERSION,
    copyRatio: denominator ? protectedMask.size / denominator : 0, matches, allowedMatches, contextEvidence,
    sourceCoverage, coverageComplete, warnings: coverageComplete ? [] : ['Evidence processing exceeded safe limits; human-only review is required.'] };
}
export const detectPromptCopying = detectProtectedCopy;