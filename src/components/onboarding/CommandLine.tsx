import { Check, Copy } from '@droidex/icons';
import { useCopiedFlash } from '../transcript/primitives';
import { Button } from '../ui/Button';

/** A shell command DROIDEX runs or asks you to run, with a copy button. */
export function CommandLine({ command }: { command: string }) {
  const { copied, copy } = useCopiedFlash();
  return (
    <div className="ob-command">
      <span className="select-none font-mono text-code-sm text-quiet" aria-hidden="true">
        $
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-code-sm text-primary" title={command}>
        {command}
      </code>
      <Button
        variant="ghost"
        size="sm"
        icon={copied ? Check : Copy}
        aria-label={copied ? 'Copied' : 'Copy command'}
        onClick={() => {
          copy(command);
        }}
      />
    </div>
  );
}
