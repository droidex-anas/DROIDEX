import { BrandMark } from '../../BrandMark';
import { Button } from '../../ui/Button';

// Welcome cover, mirroring the app's own welcome screen: pixel brand mark, one
// calm headline in the UI font, a single primary action, and the same
// droid-rise stagger. First run should feel like the app, not a landing page.
export function CoverStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="droid-rise">
        <BrandMark size={34} className="text-accent" />
      </div>
      <h1
        className="droid-rise mt-6 text-balance text-title text-primary"
        style={{ animationDelay: '90ms' }}
      >
        Let&apos;s get you set up.
      </h1>
      <p
        className="droid-rise mt-3 max-w-xs text-body text-muted"
        style={{ animationDelay: '160ms' }}
      >
        A quick tour: check your machine, install the Droid CLI, connect your account, and pick a
        few defaults.
      </p>
      <div className="droid-rise mt-10" style={{ animationDelay: '230ms' }}>
        <Button variant="primary" size="lg" onClick={onNext}>
          Get started
        </Button>
      </div>
    </div>
  );
}
