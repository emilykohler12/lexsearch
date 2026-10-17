import type { Contradiction } from '../../api/types';
import { FINDING_CONFIDENCE_LABELS, FINDING_KIND_LABELS } from '../../lib/format';

/** The confirmed contradictions as plain text, to paste into a brief or into notes. */
export function findingsToText(caseTitle: string, findings: Contradiction[]): string {
  const lines = [`Contradicciones — ${caseTitle}`, ''];

  findings.forEach((finding, index) => {
    lines.push(`${index + 1}. [${FINDING_CONFIDENCE_LABELS[finding.confidence]} · ${FINDING_KIND_LABELS[finding.kind]}] ${finding.title}`);
    if (finding.explanation) lines.push(`   ${finding.explanation}`);
    for (const statement of finding.statements) {
      const title = statement.document?.title ?? statement.documentTitle;
      lines.push(statement.quoteVerified ? `   - ${title}: «${statement.quote}»` : `   - ${title}: (frase sin verificar)`);
    }
    if (finding.note.trim()) lines.push(`   Nota: ${finding.note.trim()}`);
    lines.push('');
  });

  return lines.join('\n').trimEnd();
}
