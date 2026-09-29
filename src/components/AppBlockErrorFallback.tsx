import { CircleAlert } from 'lucide-react';
import { AppBlockRepair } from './AppBlockRepair';

export function AppBlockErrorFallback({ message, source }: { message: string; source: string }) {
  return (
    <div role="alert" className="my-3 rounded-2xl bg-droid-surface p-4 shadow-droid-sm">
      <div className="flex items-start gap-3">
        <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-droid-orange/10 text-droid-orange">
          <CircleAlert aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-7 text-droid-text">
            This visualization didn’t load
          </p>
          <p className="text-[12px] leading-5 text-droid-text-secondary">
            It stopped with an error before anything could be drawn.
          </p>
          <p className="mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-droid-elevated px-3 py-2 font-mono text-[11px] leading-[18px] text-droid-text-secondary">
            {message}
          </p>
          <AppBlockRepair source={source} message={message} />
        </div>
      </div>
    </div>
  );
}
