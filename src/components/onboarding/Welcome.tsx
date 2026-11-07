import { PROVIDER_LABELS, PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import { BrandMark } from '../BrandMark';
import { ModelIcon } from '../ModelIcon';
import { Button } from '../ui/Button';
import { AGENTS } from './agents';

export function Welcome({
  finishing,
  onStart,
  onSkip,
}: {
  finishing: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex h-full flex-col justify-center pb-20">
      <h1 className="droid-rise text-hero text-primary">
        Welcome to
        <BrandMark size={52} className="ob-hero-mark" />
      </h1>
      <p
        className="droid-rise mt-5 max-w-sm text-body-lg text-secondary"
        style={{ animationDelay: '80ms' }}
      >
        One desktop for your coding agents. Run Droid, Claude Code and Codex side by side, each in
        its own chats.
      </p>
      <div className="droid-rise mt-9 flex w-80 flex-col gap-2" style={{ animationDelay: '160ms' }}>
        <Button variant="primary" size="lg" data-primary className="w-full" onClick={onStart}>
          Get started
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          loading={finishing}
          disabled={finishing}
          onClick={onSkip}
        >
          Skip setup
        </Button>
      </div>
      <div
        className="droid-rise mt-12 flex items-center gap-4 text-caption text-muted"
        style={{ animationDelay: '240ms' }}
      >
        <span>Works with</span>
        {AGENTS.map((agent) => (
          <span key={agent} className="flex items-center gap-1.5">
            <ModelIcon provider={PROVIDER_MARKS[agent]} size={14} />
            {PROVIDER_LABELS[agent]}
          </span>
        ))}
      </div>
    </div>
  );
}
