import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { flush } from '../../../test/canvasTransport';
import * as canvasRequests from '../client';
import type * as ProposalReview from './proposalReview';
import type * as DocumentRead from './useDesignSystemDocument';

// The document's hooks run here on just enough of React for them: a render
// runs the effects whose dependencies changed, and an unmount every cleanup.
type Deps = readonly unknown[];

class Effect {
  cleanup: (() => void) | undefined;
  constructor(readonly deps: Deps) {}
}

class Memo {
  constructor(
    readonly deps: Deps,
    readonly value: unknown,
  ) {}
}

/** One mounted component's hooks, in the order it calls them. */
interface Component {
  slots: unknown[];
  effects: (() => void)[];
  index: number;
}

let rendering: Component | null = null;

function mount(): Component {
  return { slots: [], effects: [], index: 0 };
}

function render<T>(component: Component, hooks: () => T): T {
  rendering = component;
  component.index = 0;
  const result = hooks();
  rendering = null;
  for (const run of component.effects.splice(0)) run();
  return result;
}

function unmount(component: Component): void {
  for (const slot of component.slots) if (slot instanceof Effect) slot.cleanup?.();
}

function nextSlot(): { component: Component; at: number } {
  assert.ok(rendering, 'a hook ran outside a render');
  return { component: rendering, at: rendering.index++ };
}

const sameDeps = (a: Deps, b: Deps) =>
  a.length === b.length && a.every((value, at) => Object.is(value, b[at]));

const react = {
  createContext: (value: unknown) => ({ value }),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useRef(initial: unknown) {
    const { component, at } = nextSlot();
    if (!(at in component.slots)) component.slots[at] = { current: initial };
    return component.slots[at];
  },
  useState(initial: unknown) {
    const { component, at } = nextSlot();
    if (!(at in component.slots)) component.slots[at] = initial;
    const set = (next: unknown) => {
      component.slots[at] = next;
    };
    return [component.slots[at], set];
  },
  useCallback(callback: unknown, deps: Deps) {
    const { component, at } = nextSlot();
    const kept = component.slots[at];
    if (kept instanceof Memo && sameDeps(kept.deps, deps)) return kept.value;
    component.slots[at] = new Memo(deps, callback);
    return callback;
  },
  useEffect(effect: () => (() => void) | undefined, deps: Deps) {
    const { component, at } = nextSlot();
    const previous = component.slots[at];
    if (previous instanceof Effect && sameDeps(previous.deps, deps)) return;
    const next = new Effect(deps);
    component.slots[at] = next;
    component.effects.push(() => {
      if (previous instanceof Effect) previous.cleanup?.();
      next.cleanup = effect();
    });
  },
};

/** Two saved kits, each with a proposal, whose decisions wait until the test settles them. */
function fakeKits() {
  const decided: string[] = [];
  let release: (() => void) | null = null;
  const held = (decision: string) => {
    decided.push(decision);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const canvasClient = {
    subscribeDesignSystems: () => () => undefined,
    designSystems: {
      list: () => Promise.resolve(['kit-a', 'kit-b'].map((id) => ({ id, version: 1 }))),
      read: ({ id, version }: { id: string; version: number }) =>
        Promise.resolve({
          id,
          version,
          latestVersion: version,
          proposal: { proposalId: `${id}-proposal` },
        }),
      acceptProposal: (_mutationId: string, id: string, proposalId: string) =>
        held(`accept ${id}, ${proposalId}`),
      discardProposal: (id: string, proposalId: string) => held(`discard ${id}, ${proposalId}`),
    },
  };
  const imports: Record<string, unknown> = {
    react,
    '../canvasClient': { canvasClient },
    '../client': canvasRequests,
    '../../../lib/toast': { pushToast: () => undefined },
    '../../../lib/bridge': { bridge: { onReconnected: () => () => undefined } },
  };

  function load(file: string): unknown {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    runInNewContext(outputText, {
      module,
      exports: module.exports,
      crypto: globalThis.crypto,
      require: (name: string) => {
        if (name === './useIsMounted') return load('./useIsMounted.ts');
        if (name in imports) return imports[name];
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    return module.exports;
  }

  return {
    decided,
    load,
    settle() {
      assert.ok(release, 'no decision was sent');
      release();
    },
  };
}
for (const choice of ['accept', 'discard'] as const) {
  test(`a proposal's ${choice} that settles after another kit opened leaves that kit on screen`, async () => {
    const kits = fakeKits();
    const { useDesignSystemDocument } = kits.load(
      './useDesignSystemDocument.ts',
    ) as typeof DocumentRead;
    const { startReview, useIsReviewing, useProposalDecision } = kits.load(
      './proposalReview.ts',
    ) as typeof ProposalReview;
    const pane = mount();
    const showKit = (id: string) => render(pane, () => useDesignSystemDocument(id, undefined));

    showKit('kit-a');
    await flush();
    const { read, show } = showKit('kit-a');
    assert.ok(read.status === 'ready');
    startReview('kit-a');
    const kitA = mount();
    render(kitA, () => useProposalDecision(read.view, show))[choice]();
    // Kit B's read takes A's place in the pane, and A's document unmounts.
    showKit('kit-b');
    unmount(kitA);
    await flush();
    kits.settle();
    await flush();

    const shown = showKit('kit-b').read;
    assert.equal(shown.status === 'ready' ? shown.view.id : shown.status, 'kit-b');
    assert.deepEqual(kits.decided, [`${choice} kit-a, kit-a-proposal`]);
    assert.equal(
      render(mount(), () => useIsReviewing('kit-a')),
      false,
      'the decided review ended',
    );
  });
}
