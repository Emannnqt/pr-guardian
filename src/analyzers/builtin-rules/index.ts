import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

import type { FindingCandidate } from '../../core/schema.js';
import type { Analyzer, AnalyzerInput, AnalyzerOutput } from '../analyzer.js';
import { isCommentLine, maskNonCode } from './mask.js';
import { BUILTIN_RULES, type LineRule } from './rules.js';

export const BUILTIN_ANALYZER_NAME = 'builtin-rules';

/** In-process analyzer that applies the built-in line rules to added lines. */
export function createBuiltinRulesAnalyzer(rules: readonly LineRule[] = BUILTIN_RULES): Analyzer {
  return {
    name: BUILTIN_ANALYZER_NAME,
    analyze: async (input: AnalyzerInput, signal: AbortSignal): Promise<AnalyzerOutput> => {
      const findings: FindingCandidate[] = [];
      for (const file of input.files) {
        // Yield between files so the orchestrator's timeout can fire and abort us.
        await yieldToEventLoop();
        signal.throwIfAborted();
        for (const { line, content } of file.addedLines) {
          const ruleLine = {
            raw: content,
            code: isCommentLine(content) ? '' : maskNonCode(content),
          };
          for (const rule of rules) {
            const suffix = rule.match(ruleLine);
            if (suffix === undefined) continue;
            findings.push({
              title: `${rule.title}${suffix}`,
              severity: rule.severity,
              category: rule.category,
              confidence: rule.confidence,
              filePath: file.path,
              startLine: line,
              endLine: line,
              explanation: rule.explanation,
              // Lines are already capped by maxLineLength. Redaction happens centrally
              // during normalization; truncating here could split a secret and leak part of it.
              evidence: content.trim(),
              suggestedFix: rule.suggestedFix,
              source: 'static-analysis',
              ruleId: rule.id,
            });
          }
        }
      }
      return { status: 'succeeded', findings };
    },
  };
}
