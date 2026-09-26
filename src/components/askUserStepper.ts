// Stepper state for the inline ask-user card: which question is showing, what
// has been picked or typed for each, and whether the type-your-own field is
// open. Kept pure so the flow (pick, type, back, forward, submit payload) is
// testable without a DOM; AskUserInline owns focus and the actual commands.
//
// Answers are keyed by the question's own index, not by step position, so
// stepping back and forth never reassigns an answer to a different question.

import type { QuestionAnswer, SessionQuestion } from '../types/bridge';

/** What one question is holding: what was picked, what was typed, and whether
    the type-your-own field is open. */
export interface HeldAnswer {
  readonly selected: readonly string[];
  readonly custom: string;
  readonly typing: boolean;
}

export interface StepperState {
  readonly total: number;
  readonly current: number;
  readonly answers: Readonly<Record<number, HeldAnswer>>;
}

export type StepperAction =
  | { type: 'pickOption'; questionIndex: number; option: string; multiSelect?: boolean }
  | { type: 'openCustomAnswer'; questionIndex: number }
  | { type: 'typeAnswer'; questionIndex: number; value: string; multiSelect?: boolean }
  | { type: 'back' }
  | { type: 'forward' };

const EMPTY: HeldAnswer = { selected: [], custom: '', typing: false };

export function createStepper(total: number): StepperState {
  return { total, current: 0, answers: {} };
}

function withAnswer(state: StepperState, questionIndex: number, next: HeldAnswer): StepperState {
  return { ...state, answers: { ...state.answers, [questionIndex]: next } };
}

export function stepperReducer(state: StepperState, action: StepperAction): StepperState {
  switch (action.type) {
    // One choice replaces the answer; several toggle inside it and leave any
    // typed text alone, because both travel in the same answer.
    case 'pickOption': {
      const held = answerFor(state, action.questionIndex);
      if (!action.multiSelect) {
        return withAnswer(state, action.questionIndex, {
          selected: [action.option],
          custom: '',
          typing: false,
        });
      }
      const selected = held.selected.includes(action.option)
        ? held.selected.filter((option) => option !== action.option)
        : [...held.selected, action.option];
      return withAnswer(state, action.questionIndex, { ...held, selected, typing: false });
    }
    case 'openCustomAnswer':
      return withAnswer(state, action.questionIndex, {
        ...answerFor(state, action.questionIndex),
        typing: true,
      });
    // Typing is the answer for a single-choice question, so the picked option
    // steps aside; where several are allowed it joins them.
    case 'typeAnswer': {
      const held = answerFor(state, action.questionIndex);
      return withAnswer(state, action.questionIndex, {
        ...held,
        ...(action.multiSelect ? {} : { selected: [] }),
        custom: action.value,
        typing: true,
      });
    }
    case 'back':
      return state.current === 0 ? state : { ...state, current: state.current - 1 };
    case 'forward':
      return state.current >= state.total - 1 ? state : { ...state, current: state.current + 1 };
  }
}

/** What is held for a question, empty when it has nothing yet. */
export function answerFor(state: StepperState, questionIndex: number): HeldAnswer {
  return state.answers[questionIndex] ?? EMPTY;
}

export function isSelected(state: StepperState, questionIndex: number, option: string): boolean {
  return answerFor(state, questionIndex).selected.includes(option);
}

export function isTyping(state: StepperState, questionIndex: number): boolean {
  return answerFor(state, questionIndex).typing;
}

/** An answer with nothing picked and nothing typed cannot be submitted. */
export function canAdvance(state: StepperState, questionIndex: number): boolean {
  const held = answerFor(state, questionIndex);
  return held.selected.length > 0 || held.custom.trim().length > 0;
}

export function isLastStep(state: StepperState): boolean {
  return state.current === state.total - 1;
}

/** Payload for respondQuestion: every question with what it was answered with. */
export function submissionAnswers(
  questions: SessionQuestion['questions'],
  state: StepperState,
): QuestionAnswer[] {
  return questions.map((q) => {
    const held = answerFor(state, q.index);
    const custom = held.custom.trim();
    return {
      index: q.index,
      question: q.question,
      selected: [...held.selected],
      ...(custom ? { custom } : {}),
    };
  });
}
