import { useId, useRef, useState } from 'react';
import { X } from '@droidex/icons';

import { parseMcpVariables } from '../lib/mcpConfig';
import type { McpServerInput } from '../types/bridge';
import { Dropdown } from './settingsKit';
import { Button } from './ui/Button';
import { Dialog, DialogActions, DialogBody, DialogTitle } from './ui/Dialog';
import { Field, Input } from './ui/Field';

type ServerType = McpServerInput['serverType'];

const SERVER_TYPES: { value: ServerType; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'SSE' },
  { value: 'stdio', label: 'Local command' },
];

export function AddMcpServerDialog({
  disabled,
  serverError,
  onCancel,
  onAdd,
}: {
  disabled: boolean;
  serverError?: string;
  onCancel: () => void;
  onAdd: (server: McpServerInput) => void;
}) {
  const [serverType, setServerType] = useState<ServerType>('http');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [argumentsText, setArgumentsText] = useState('');
  const [variablesText, setVariablesText] = useState('');
  const [error, setError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();

  const submit = () => {
    setError(undefined);
    try {
      const pairs = parseMcpVariables(variablesText);
      if (!name.trim() || !location.trim()) throw new Error('Name and connection are required.');
      if (serverType === 'stdio') {
        onAdd({
          name: name.trim(),
          serverType,
          command: location.trim(),
          args: argumentsText
            .split('\n')
            .map((argument) => argument.trim())
            .filter(Boolean),
          env: pairs,
        });
      } else {
        onAdd({ name: name.trim(), serverType, url: location.trim(), headers: pairs });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  };

  const shownError = error ?? serverError;

  return (
    <Dialog
      size="form"
      onClose={onCancel}
      dismissible={!disabled}
      initialFocusRef={nameRef}
      aria-describedby={descriptionId}
      aria-busy={disabled}
    >
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>Add MCP server</DialogTitle>
            <p id={descriptionId} className="mt-1 text-body text-secondary">
              Saved to your Droid CLI user configuration and available to new DROIDEX sessions.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={onCancel}
            disabled={disabled}
            aria-label="Close add MCP server"
            className="-mr-2 -mt-1"
          />
        </div>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <Field label="Name" className="min-w-0 flex-1">
              <Input
                ref={nameRef}
                value={name}
                placeholder="sentry"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="select-none text-label text-secondary">Type</span>
              <Dropdown
                value={serverType}
                options={SERVER_TYPES}
                ariaLabel="Type"
                width="w-40"
                onChange={(value) => {
                  setServerType(serverTypeFromValue(value));
                }}
              />
            </div>
          </div>

          <Field label={serverType === 'stdio' ? 'Command' : 'URL'}>
            <Input
              value={location}
              placeholder={serverType === 'stdio' ? 'npx' : 'https://mcp.example.com/mcp'}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => {
                setLocation(event.target.value);
              }}
            />
          </Field>

          {serverType === 'stdio' && (
            <TextAreaField
              label="Arguments"
              hint="One argument per line"
              value={argumentsText}
              onChange={setArgumentsText}
              placeholder={'-y\n@example/mcp'}
            />
          )}

          <TextAreaField
            label={serverType === 'stdio' ? 'Environment' : 'Headers'}
            hint="One KEY=VALUE per line"
            value={variablesText}
            onChange={setVariablesText}
          />

          {shownError && (
            <p role="alert" className="text-body text-danger">
              {shownError}
            </p>
          )}
        </DialogBody>

        <DialogActions>
          <Button variant="ghost" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={disabled} disabled={disabled}>
            Add server
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function serverTypeFromValue(value: string): ServerType {
  if (value === 'sse' || value === 'stdio') return value;
  return 'http';
}

// Field's layout for a multi-line value: label above, hint below.
function TextAreaField({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const textAreaId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={textAreaId} className="select-none text-label text-secondary">
        {label}
      </label>
      <textarea
        id={textAreaId}
        aria-describedby={hintId}
        value={value}
        rows={3}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full resize-none rounded-md bg-field px-3 py-2 text-body-lg text-primary transition-colors duration-150 ease-out placeholder:text-muted hover:bg-active"
      />
      <p id={hintId} className="text-caption text-muted">
        {hint}
      </p>
    </div>
  );
}
