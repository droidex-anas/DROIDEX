import { useEffect, useReducer, useRef, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, PenLine } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { respondQuestion } from '../lib/commands';
import type { QuestionAnswer, SessionQuestion } from '@droidex/protocol';
import { ActivityStatusGlyph } from './ActivityStatusGlyph';
import { INLINE_CARD_EASE, inlineCardMotion, type InlineCardMotion } from './inlineCardMotion';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import {
  answerFor,
  canAdvance,
  createStepper,
  isLastStep,
  stepperReducer,
  submissionAnswers,
} from './askUserStepper';

// The question a chat is waiting on, drawn in the composer's slot: the main
// composer owns its surface there, and the other hosts draw it as their own
// docked card. Questions are session-scoped and queue per session: the oldest
// is the one on screen for the chat given, and other sessions signal via the
// sidebar.
export type QuestionSurface = 'card' | 'composer';

export default function AskUserInline({
  appSessionId,
  className,
  surface = 'card',
}: {
  appSessionId: string;
  /** Layout only: the gap a host leaves under the card. */
  className?: string;
  /** Whether the card draws its own docked surface or renders inside the composer's. */
  surface?: QuestionSurface;
}) {
  const dispatch = useStoreDispatch();
  const question = useStoreSelector((current) => current.pendingQuestions[appSessionId]?.[0]);

  // A request without questions cannot be answered; cancel it so the pending
  // interaction settles instead of wedging the composer. A refused send (full
  // offline queue) retries, because nothing else ever settles this request.
  useEffect(() => {
    if (question?.questions.length !== 0) return;
    let settled = false;
    const cancel = () => {
      if (settled) return true;
      if (!respondQuestion(question.appSessionId, question.requestId, true, [])) return false;
      settled = true;
      dispatch({
        type: 'CLEAR_QUESTION',
        appSessionId: question.appSessionId,
        requestId: question.requestId,
      });
      return true;
    };
    if (cancel()) return;
    const retry = setInterval(() => {
      if (cancel()) clearInterval(retry);
    }, 1000);
    return () => {
      clearInterval(retry);
    };
  }, [question, dispatch]);

  if (!question || question.questions.length === 0) return null;

  const settle = (cancelled: boolean, answers: QuestionAnswer[]) => {
    if (!respondQuestion(question.appSessionId, question.requestId, cancelled, answers)) return;
    dispatch({
      type: 'CLEAR_QUESTION',
      appSessionId: question.appSessionId,
      requestId: question.requestId,
    });
  };

  // Keyed by request so a new request mounts a fresh card instead of carrying
  // the previous step and answers into its first render. It leaves without an
  // exit, because the composer's field takes its place in the same frame.
  return (
    <QuestionCard
      key={question.requestId}
      question={question}
      className={className}
      surface={surface}
      onAnswer={(answers) => {
        settle(false, answers);
      }}
      onCancel={() => {
        settle(true, []);
      }}
    />
  );
}

const ROW =
  'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150';

function rowClass(active: boolean): string {
  return cn(ROW, active ? 'bg-active' : 'hover:bg-active/55');
}

// The trailing mark's box is always laid out, so picking never shifts a label.
function PickedMark({ picked }: { picked: boolean }) {
  return (
    <Check className={cn('mt-0.5 size-icon-sm shrink-0 text-primary', !picked && 'invisible')} />
  );
}

// Inside the composer the surrounding field is already in place; only the
// question's content fades in. Other hosts use the shared card entry motion.
function composerFieldMotion(reduceMotion: boolean | null): InlineCardMotion {
  if (reduceMotion) return inlineCardMotion(true);
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.15, ease: INLINE_CARD_EASE },
  };
}

function StepDots({
  total,
  current,
  answered,
}: {
  total: number;
  current: number;
  answered: boolean[];
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      <span className="text-caption tabular-nums text-muted">
        {current + 1} of {total}
      </span>
      <div className="flex items-center gap-1" aria-hidden="true">
        {answered.map((isAnswered, step) => (
          <span
            key={step}
            className={cn(
              'h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none',
              step === current ? 'w-4 bg-text' : 'w-1.5',
              step !== current && (isAnswered ? 'bg-muted' : 'bg-muted/40'),
            )}
          />
        ))}
      </div>
    </div>
  );
}

// One ask-user request as a stepper: a row per option plus a type-your-own row,
// Back/Next across questions, Submit on the last one. Answers are held per
// question, so stepping back and forward never loses one.
export function QuestionCard({
  question,
  className,
  surface = 'card',
  onAnswer,
  onCancel,
}: {
  question: SessionQuestion;
  className?: string;
  surface?: QuestionSurface;
  onAnswer: (answers: QuestionAnswer[]) => void;
  onCancel: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const total = question.questions.length;
  const [stepper, dispatchStep] = useReducer(stepperReducer, total, createStepper);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = stepper.current;
  const q = question.questions[step];
  const multiSelect = q.multiSelect ?? false;
  const isLast = isLastStep(stepper);
  const held = answerFor(stepper, q.index);
  const advanceEnabled = canAdvance(stepper, q.index);
  const inComposer = surface === 'composer';
  const textInset = inComposer ? 'px-3' : 'px-4';
  const optionsInset = inComposer ? 'px-1' : 'px-2';
  const actionsInset = inComposer ? 'px-2.5' : 'px-3';

  // The number keys answer once the card holds focus. It takes focus only from
  // nothing or from its own host (the composer it replaced), never from
  // something else the user is typing in.
  useEffect(() => {
    const card = cardRef.current;
    const focused = document.activeElement;
    if (!card) return;
    if (!focused || focused === document.body || card.parentElement?.contains(focused)) {
      card.focus({ preventScroll: true });
    }
  }, []);

  const pick = (option: string) => {
    dispatchStep({ type: 'pickOption', questionIndex: q.index, option, multiSelect });
  };

  const next = () => {
    if (!advanceEnabled) return;
    if (isLast) onAnswer(submissionAnswers(question.questions, stepper));
    else dispatchStep({ type: 'forward' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // The hosts close their own surface on Escape; here it only backs out of the question.
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        next();
        // The next question starts on its options, where the number keys pick.
        cardRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A focused row or button takes Enter as its own click.
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      next();
      return;
    }
    const option = /^[1-9]$/.test(event.key) ? q.options.at(Number(event.key) - 1) : undefined;
    if (!option) return;
    event.preventDefault();
    pick(option.label);
  };

  return (
    <motion.div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      {...(inComposer ? composerFieldMotion(reduceMotion) : inlineCardMotion(reduceMotion))}
      className={cn('outline-none', inComposer ? '' : 'rounded-xl bg-surface shadow-sm', className)}
    >
      <div className={cn('flex items-center gap-2 pt-3', textInset)}>
        <ActivityStatusGlyph status="input" decorative />
        <span className="min-w-0 truncate text-label text-secondary">
          {q.header ?? 'Waiting for your answer'}
        </span>
        {total > 1 && (
          <StepDots
            total={total}
            current={step}
            answered={question.questions.map((each) => canAdvance(stepper, each.index))}
          />
        )}
      </div>

      <div className={cn('pt-1.5 text-body-strong text-primary break-words', textInset)}>
        {q.question}
      </div>
      {multiSelect && (
        <div className={cn('pt-0.5 text-caption text-muted', textInset)}>Choose any that apply</div>
      )}

      <div className={cn('pt-1.5', optionsInset)}>
        {q.options.map((opt, i) => {
          const selected = held.selected.includes(opt.label);
          return (
            <button
              key={`${opt.label}-${String(i)}`}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                pick(opt.label);
              }}
              className={rowClass(selected)}
            >
              <kbd
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center font-sans text-caption tabular-nums',
                  selected ? 'text-primary' : 'text-muted',
                )}
              >
                {i + 1}
              </kbd>
              <span className="min-w-0 flex-1 pt-px">
                <span
                  className={cn(
                    'block text-body break-words',
                    selected ? 'text-primary' : 'text-secondary',
                  )}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="mt-0.5 block text-body break-words text-muted">
                    {opt.description}
                  </span>
                )}
              </span>
              <PickedMark picked={selected} />
            </button>
          );
        })}

        <label className={cn(rowClass(held.typing), 'cursor-text')}>
          <span className="flex size-5 shrink-0 items-center justify-center text-muted">
            <PenLine className="size-icon-sm" />
          </span>
          <input
            type="text"
            value={held.custom}
            onFocus={() => {
              dispatchStep({ type: 'openCustomAnswer', questionIndex: q.index });
            }}
            onChange={(e) => {
              dispatchStep({
                type: 'typeAnswer',
                questionIndex: q.index,
                value: e.target.value,
                multiSelect,
              });
            }}
            placeholder="Type your own answer"
            aria-label="Type your own answer"
            className="min-w-0 flex-1 bg-transparent pt-px text-body text-primary placeholder:text-muted outline-none"
          />
          <PickedMark picked={held.custom.trim().length > 0} />
        </label>
      </div>

      <div className={cn('flex items-center gap-1 pb-2.5 pt-1.5', actionsInset)}>
        {step > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dispatchStep({ type: 'back' });
            }}
          >
            Back
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Dismiss
          </Button>
          <Button variant="primary" size="sm" onClick={next} disabled={!advanceEnabled}>
            {isLast ? 'Submit' : 'Next'}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
