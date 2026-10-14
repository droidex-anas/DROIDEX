import { useEffect, useReducer, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { respondQuestion } from '../lib/commands';
import type { QuestionAnswer, SessionQuestion } from '../types/bridge';
import { inlineCardMotion } from './inlineCardMotion';
import { Button } from './ui/Button';
import {
  answerFor,
  canAdvance,
  createStepper,
  isLastStep,
  stepperReducer,
  submissionAnswers,
} from './askUserStepper';

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

// The picked mark, drawn by fill: a dot inside a circle when one answer is
// allowed, a check inside a rounded square when several are.
function Mark({ checked, multi }: { checked: boolean; multi: boolean }) {
  return (
    <span
      className={`mt-px flex size-4 shrink-0 items-center justify-center ${
        multi ? 'rounded-xs' : 'rounded-full'
      } ${checked ? 'bg-text' : 'bg-active'}`}
      aria-hidden="true"
    >
      {checked &&
        (multi ? (
          <Check className="size-3 text-bg" strokeWidth={2.5} />
        ) : (
          <span className="size-1.5 rounded-full bg-bg" />
        ))}
    </span>
  );
}

const ROW_BASE = 'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors';

function rowClass(active: boolean): string {
  return `${ROW_BASE} ${active ? 'bg-bg/55' : 'hover:bg-bg/30'}`;
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
      className="mb-2.5 overflow-hidden rounded-xl bg-raised shadow-lg"
    >
      <div className="flex items-start gap-2 px-4 pt-3.5">
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          {q.header && <div className="text-caption break-words text-muted">{q.header}</div>}
          <div className="text-body-strong text-primary break-words">{q.question}</div>
        </div>
        {total > 1 && (
          <span className="shrink-0 pt-px text-caption tabular-nums text-muted">
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
                  className={`block text-body break-words ${
                    selected ? 'text-primary' : 'text-secondary'
                  }`}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="mt-0.5 block text-body break-words text-muted">
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
              className="min-w-0 flex-1 bg-transparent text-body text-primary placeholder:text-muted outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                dispatchStep({ type: 'openCustomAnswer', questionIndex: q.index });
              }}
              className="min-w-0 flex-1 text-left text-body text-secondary"
            >
              Type your own answer
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-2.5 pb-3.5">
        {step > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              dispatchStep({ type: 'back' });
            }}
          >
            Back
          </Button>
        )}
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={next} disabled={!advanceEnabled}>
          {isLast ? 'Submit' : 'Next'}
        </Button>
      </div>
    </motion.div>
  );
}
