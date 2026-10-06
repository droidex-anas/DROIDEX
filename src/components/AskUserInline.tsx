import { useEffect, useReducer, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { respondQuestion } from '../lib/commands';
import type { QuestionAnswer, SessionQuestion } from '../types/bridge';
import { inlineCardMotion } from './inlineCardMotion';
import {
  answerFor,
  canAdvance,
  createStepper,
  isLastStep,
  stepperReducer,
  submissionAnswers,
} from './askUserStepper';

const ACCENT = 'var(--droid-accent)';

// Inline question card shown above the composer when the agent asks the user
// something. Questions are session-scoped and queue per session: the oldest is
// the one on screen for the chat given, and other sessions signal via the
// sidebar.
export default function AskUserInline({ appSessionId }: { appSessionId: string }) {
  const dispatch = useStoreDispatch();
  const question = useStoreSelector((current) => current.pendingQuestions[appSessionId]?.[0]);
  const isEmpty = question?.questions.length === 0;

  // A request without questions cannot be answered; cancel it so the pending
  // interaction settles instead of wedging the composer.
  useEffect(() => {
    if (question?.questions.length === 0) {
      respondQuestion(question.appSessionId, question.requestId, true, []);
      dispatch({
        type: 'CLEAR_QUESTION',
        appSessionId: question.appSessionId,
        requestId: question.requestId,
      });
    }
  }, [question, dispatch]);

  const settle = (request: SessionQuestion, cancelled: boolean, answers: QuestionAnswer[]) => {
    respondQuestion(request.appSessionId, request.requestId, cancelled, answers);
    dispatch({
      type: 'CLEAR_QUESTION',
      appSessionId: request.appSessionId,
      requestId: request.requestId,
    });
  };

  // The card is keyed by request so a new request mounts a fresh card instead
  // of carrying the previous step and answers into its first render.
  return (
    <AnimatePresence>
      {question && !isEmpty && (
        <QuestionCard
          key={question.requestId}
          question={question}
          onAnswer={(answers) => {
            settle(question, false, answers);
          }}
          onCancel={() => {
            settle(question, true, []);
          }}
        />
      )}
    </AnimatePresence>
  );
}

// The picked mark: a filled dot inside a circle when one answer is allowed, a
// check inside a rounded square when several are.
function Mark({ checked, multi }: { checked: boolean; multi: boolean }) {
  return (
    <span
      className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center border ${
        multi ? 'rounded-[5px]' : 'rounded-full'
      } ${checked ? 'border-droid-text-secondary' : 'border-droid-text-muted/50'}`}
      aria-hidden="true"
    >
      {checked &&
        (multi ? (
          <Check className="h-3 w-3 text-droid-text" strokeWidth={2.5} />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-droid-text" />
        ))}
    </span>
  );
}

const ROW_BASE =
  'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors';

function rowClass(active: boolean): string {
  return `${ROW_BASE} ${
    active
      ? 'border-droid-border-hover bg-droid-bg/55'
      : 'border-transparent hover:border-droid-border hover:bg-droid-bg/30'
  }`;
}

// One ask-user request as a stepper: a row per option plus a type-your-own row,
// Back/Next across questions, Submit on the last one. Answers are held per
// question, so stepping back and forward never loses one.
export function QuestionCard({
  question,
  onAnswer,
  onCancel,
}: {
  question: SessionQuestion;
  onAnswer: (answers: QuestionAnswer[]) => void;
  onCancel: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const total = question.questions.length;
  const [stepper, dispatchStep] = useReducer(stepperReducer, total, createStepper);
  const inputRef = useRef<HTMLInputElement>(null);

  const step = stepper.current;
  const q = question.questions[step];
  const multiSelect = q.multiSelect ?? false;
  const isLast = isLastStep(stepper);
  const held = answerFor(stepper, q.index);
  const typing = held.typing;
  const advanceEnabled = canAdvance(stepper, q.index);

  useEffect(() => {
    if (typing) {
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => {
        clearTimeout(t);
      };
    }
  }, [typing, step]);

  const next = () => {
    if (!advanceEnabled) return;
    if (isLast) onAnswer(submissionAnswers(question.questions, stepper));
    else dispatchStep({ type: 'forward' });
  };

  return (
    <motion.div
      {...inlineCardMotion(reduceMotion)}
      className="mb-2.5 overflow-hidden rounded-2xl border border-droid-border bg-droid-raised shadow-droid"
    >
      <div className="flex items-start gap-2 px-4 pt-3.5">
        <span
          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: ACCENT }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          {q.header && (
            <div className="text-[11px] leading-snug break-words text-droid-text-muted">
              {q.header}
            </div>
          )}
          <div className="text-[13px] font-medium leading-snug text-droid-text break-words">
            {q.question}
          </div>
        </div>
        {total > 1 && (
          <span className="shrink-0 pt-px text-[11px] text-droid-text-muted">
            {step + 1} of {total}
          </span>
        )}
      </div>

      <div className="mt-2.5 space-y-1 px-3">
        {q.options.map((opt, i) => {
          const selected = held.selected.includes(opt.label);
          return (
            <button
              key={`${opt.label}-${String(i)}`}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                dispatchStep({
                  type: 'pickOption',
                  questionIndex: q.index,
                  option: opt.label,
                  multiSelect,
                });
              }}
              className={rowClass(selected)}
            >
              <Mark checked={selected} multi={multiSelect} />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[13px] leading-snug break-words ${
                    selected ? 'text-droid-text' : 'text-droid-text-secondary'
                  }`}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="mt-0.5 block text-[12px] leading-snug break-words text-droid-text-muted">
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        <div className={rowClass(typing)}>
          <Mark checked={typing} multi={multiSelect} />
          {typing ? (
            <input
              ref={inputRef}
              type="text"
              value={held.custom}
              onChange={(e) => {
                dispatchStep({
                  type: 'typeAnswer',
                  questionIndex: q.index,
                  value: e.target.value,
                  multiSelect,
                });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  next();
                }
              }}
              placeholder="Type your own answer"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-droid-text placeholder:text-droid-text-muted outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                dispatchStep({ type: 'openCustomAnswer', questionIndex: q.index });
              }}
              className="min-w-0 flex-1 text-left text-[13px] text-droid-text-secondary"
            >
              Type your own answer
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-2.5 pb-3.5">
        {step > 0 && (
          <button
            type="button"
            onClick={() => {
              dispatchStep({ type: 'back' });
            }}
            className="rounded-full px-3.5 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-surface hover:text-droid-text"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-droid-border bg-droid-bg/40 px-3.5 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:border-droid-border-hover hover:text-droid-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!advanceEnabled}
          className="rounded-full px-4 py-1.5 text-[12px] font-semibold text-droid-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          style={{ background: ACCENT }}
        >
          {isLast ? 'Submit' : 'Next'}
        </button>
      </div>
    </motion.div>
  );
}
