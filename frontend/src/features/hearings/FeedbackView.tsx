import type { HearingFeedback, HearingFeedbackPoint } from '../../api/types';

/** Her own words (or her brief's), when the server found them. */
function Quote({ point }: { point: HearingFeedbackPoint }) {
  if (!point.quote || !point.quoteVerified) return null;
  return (
    <blockquote className="mt-2 border-l-2 border-brass-500 pl-3 text-sm break-words">
      “{point.quote}”
      <span className="mt-1 block text-xs text-muted">{point.quoteSource === 'ESCRITO' ? 'De tu escrito' : 'Lo que dijiste'}</span>
    </blockquote>
  );
}

/** How the practice went: what worked, what to reinforce and what to have ready. */
export function FeedbackView({ feedback }: { feedback: HearingFeedback }) {
  return (
    <section aria-labelledby="feedback-title" className="space-y-5">
      <h2 id="feedback-title" className="text-xl">
        Devolución
      </h2>

      <p className="card p-4 text-sm leading-relaxed break-words sm:text-base">{feedback.summary}</p>

      {feedback.strengths.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-sans text-base font-medium">Lo que salió bien</h3>
          <ul className="space-y-3">
            {feedback.strengths.map((strength, index) => (
              <li key={index} className="card border-l-4 border-l-emerald-600 p-3 sm:p-4">
                <p className="text-sm break-words sm:text-base">{strength.point}</p>
                <Quote point={strength} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.weaknesses.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-sans text-base font-medium">Para reforzar</h3>
          <ul className="space-y-3">
            {feedback.weaknesses.map((weakness, index) => (
              <li key={index} className="card border-l-4 border-l-amber-500 p-3 sm:p-4">
                <p className="text-sm font-medium break-words sm:text-base">{weakness.point}</p>
                <Quote point={weakness} />
                {weakness.why && <p className="mt-2 text-sm break-words text-muted">{weakness.why}</p>}
                {weakness.suggestion && <p className="mt-2 text-sm break-words">{weakness.suggestion}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.prepare.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-sans text-base font-medium">Para tener listo</h3>
          <ul className="card list-disc space-y-1.5 py-3 pr-4 pl-8 text-sm break-words sm:text-base">
            {feedback.prepare.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
