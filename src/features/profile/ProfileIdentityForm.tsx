import { motion } from 'framer-motion';
import { useId } from 'react';
import { HANDLE_PATTERN } from '../../../packages/remote/src';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import type { ProfileIdentity } from './profileShare';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
// The browser `pattern` attribute compiles with the `v` flag, which needs the hyphen escaped.
const HANDLE_INPUT_PATTERN = HANDLE_PATTERN.source.replace('-]', '\\-]');

export function ProfileIdentityForm({
  draft,
  onDraftChange,
  usernameLocked,
  usernameHint,
  saving,
  onCancel,
  onSave,
}: {
  draft: ProfileIdentity;
  onDraftChange: (draft: ProfileIdentity) => void;
  usernameLocked: boolean;
  usernameHint: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const hintId = useId();
  return (
    <motion.form
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            autoFocus
            required
            maxLength={80}
            placeholder="Ada Lovelace"
            value={draft.displayName}
            onChange={(event) => {
              onDraftChange({ ...draft, displayName: event.target.value });
            }}
          />
        </Field>
        <Field label="Username">
          <Input
            leading="@"
            required
            pattern={HANDLE_INPUT_PATTERN}
            disabled={usernameLocked}
            minLength={3}
            maxLength={30}
            placeholder="ada"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={hintId}
            value={draft.username}
            onChange={(event) => {
              onDraftChange({ ...draft, username: event.target.value.toLowerCase() });
            }}
          />
        </Field>
      </div>
      <p id={hintId} className="mt-2 text-caption text-muted">
        {usernameHint}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          Save
        </Button>
      </div>
    </motion.form>
  );
}
