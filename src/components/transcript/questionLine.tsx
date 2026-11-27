import { useState } from 'react';
import type { TranscriptEvent } from '@droidex/protocol';
import { stripAnsi } from '../../lib/tools';
import { Caret, ErrorTag, Expand, InterruptedTag, ToolPanel } from './primitives';
import { ToolCallCard } from './commandCard';

// Droid asks through `AskUser`, Claude through `AskUserQuestion`. Codex asks
// outside its transcript, so it never reaches this row.
export function isQuestionTool(name?: string): boolean {
  return name === 'AskUser' || name === 'AskUserQuestion';
}

interface AnsweredQuestion {
  question: string;
  answer: string;
}

// Droid's questionnaire numbers each `[question]` line; Claude sends a list.
function askedCount(args: unknown): number {
  if (!args || typeof args !== 'object') return 0;
  const { questionnaire, questions } = args as { questionnaire?: unknown; questions?: unknown };
  if (Array.isArray(questions)) return questions.length;
  if (typeof questionnaire !== 'string') return 0;
  return questionnaire.match(/^\s*\d+\.\s*\[question\]/gm)?.length ?? 0;
}

// Droid answers in blocks ("1. [question] …" then "[answer] …"); Claude in one
// line (`User has answered your questions: "Q"="A", …`).
function answeredQuestions(output: string): AnsweredQuestion[] {
  const blocks = output.split(/^\s*\d+\.\s*\[question\]\s*/m).slice(1);
  if (blocks.length > 0) {
    return blocks.map((block) => {
      const [question, ...rest] = block.split(/\n\s*\[answer\]\s*/);
      return { question: question.trim(), answer: rest.join('\n').trim().replace(/\n+/g, ', ') };
    });
  }
  return [...output.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)].map((match) => ({
    question: match[1],
    answer: match[2],
  }));
}

// The states with nothing to open: still waiting, cut off, dismissed, or
// settled without a result.
function oneLineVerb(state: {
  running: boolean;
  interrupted: boolean;
  dismissed: boolean;
  empty: boolean;
}): string | null {
  if (state.running) return 'Asking';
  if (state.dismissed) return 'Dismissed';
  if (state.interrupted || state.empty) return 'Asked';
  return null;
}

function countLabel(count: number): string {
  if (count === 0) return '';
  return count === 1 ? '1 question' : `${String(count)} questions`;
}

// An option the model marked as its pick carries the mark in its label; the
// answer is the choice, not the advice.
function shownAnswer(answer: string): string {
  return answer.replace(/\s*\(Recommended\)$/, '');
}

/* ── A question the agent asked: the composer showed the card, so the
   transcript keeps only what was decided. "Answered 2 questions" opens to
   each question over its answer; a dismissal is one quiet line. ── */
export function QuestionLine({
  event,
  output,
  error = false,
  interrupted = false,
  running = false,
}: {
  event: TranscriptEvent;
  output?: string;
  error?: boolean;
  interrupted?: boolean;
  running?: boolean;
}) {
  const out = output ? stripAnsi(output).trim() : '';
  const dismissed = error && /cancelled by user|dismissed the question/i.test(out);
  const answered = error ? [] : answeredQuestions(out);
  const count = countLabel(answered.length || askedCount(event.toolArgs));

  const verb = oneLineVerb({ running, interrupted, dismissed, empty: !error && !out });
  if (verb) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-body">
        <span className={running ? 'shimmer-text shrink-0 font-medium' : 'shrink-0 text-secondary'}>
          {verb}
        </span>
        <span className="min-w-0 truncate text-muted">{count}</span>
        {interrupted && <InterruptedTag />}
      </div>
    );
  }
  return <QuestionOutcome count={count} answered={answered} output={out} error={error} />;
}

function QuestionOutcome({
  count,
  answered,
  output,
  error,
}: {
  count: string;
  answered: AnsweredQuestion[];
  output: string;
  error: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="group flex w-full min-w-0 items-center gap-1.5 text-left text-body"
        aria-expanded={open}
      >
        <span className="shrink-0 text-secondary">{error ? 'Asked' : 'Answered'}</span>
        <span className="min-w-0 truncate text-muted">{count}</span>
        <Caret open={open} />
        {error && <ErrorTag />}
      </button>
      <Expand open={open}>
        <div className="mt-1.5 pl-5">
          {answered.length > 0 ? (
            <ToolPanel>
              <dl className="flex flex-col gap-2 px-3.5 py-2.5">
                {answered.map(({ question, answer }, index) => (
                  <div key={`${String(index)}-${question}`}>
                    <dt className="text-caption text-muted break-words">{question}</dt>
                    <dd className="text-body text-primary break-words">{shownAnswer(answer)}</dd>
                  </div>
                ))}
              </dl>
            </ToolPanel>
          ) : (
            <ToolCallCard heading={null} output={output} error={error} />
          )}
        </div>
      </Expand>
    </div>
  );
}
