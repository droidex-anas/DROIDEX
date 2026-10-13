# Toast

A quiet, raised card for results, errors and updates. Colour lives only in its 16px status icon: no dots, no coloured side bars, no tinted backgrounds.

**Anatomy**
- `raised` fill, `radius-lg`, `shadow-lg` (which carries the edge, so no border), 356px wide.
- Padding `space-3` on top, bottom and right, 14px on the left.
- A 16px filled status icon aligned to the title's first line:
  - `success`: circle check;
  - `danger`: circle alert;
  - `warning`: triangle;
  - `link`: circle arrow, for updates;
  - `text-muted`: spinner, for loading.
  
  Info toasts have no icon.
- Title in `body-strong`. Optional description in 12/16 `text-secondary`, one line saying what happened or what to do next.
- One text action at most (Undo, Retry, Restart, View): a 24px chip in `text` at 6%. The close button is a 24px ghost X.

**Behaviour** (matches `src/lib/toast.ts`)
- **How long each stays:**
  - Success and info: 4s, or 6s when the toast has an action.
  - Warning: 6s.
  - Error, update and loading: stay until dismissed or replaced.
- **Pausing:** hovering the stack, focusing it, or leaving the window pauses every countdown. When it resumes, each picks up where it stopped.
- **Close button:** on persistent toasts it's always visible. On timed toasts it appears only on hover, so a passing "Pushed to remote" stays clean.
- **Repeats:** raising the same toast again counts up (×2) instead of stacking a duplicate.
- **In-place updates:** loading → success or error, and progress ticks, change the toast where it is (the icon cross-fades with a 2px blur), so it never pops out and back in.
- **Position:** bottom-right, 16px from the edge, above the status bar. Newest at the front. Up to 3 peek out behind, 10px apart and each 5% smaller, with only their edges showing. Hovering fans the stack out 8px apart.
- **Motion:** enter rising 16px on the stack spring (520 / 38), exit in 120ms with a fade and a slight shrink. Swipe right to dismiss.
- **Keyboard:** ⌥T focuses the newest toast and Escape dismisses it. Errors use `role="alert"` and everything else `role="status"`.

**Copy**
- The title is the result, in a few words: "Pushed to remote", "Push failed", "Update ready".
- The description says why or what next. Never a stack trace, never "Error:", no exclamation marks.
- Every error says what the person can do: offer Retry, or name the fix.

**Don't**
- Use a toast for something that needs a decision. That's a dialog.
- Toast what the UI already shows. Copy shows a check in place, and a selected row is visibly selected.
- Show more than 5 at once. The oldest is dismissed first.

The app's toaster is `src/components/ui/Toaster.tsx`. A fuller implementation with the remaining variants and behaviour, ready to move into the app, is in [Toast.reference.md](Toast.reference.md).
