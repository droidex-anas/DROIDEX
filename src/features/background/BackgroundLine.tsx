import { Button } from '../../components/ui/Button';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';

/* Beside the last reply of a chat whose commands left processes running: the
   agent finished its turn, but its servers and watchers did not. Opens the
   Background tab, where they can be read, opened and stopped. */
export function BackgroundLine({ appSessionId }: { appSessionId: string }) {
  const dispatch = useStoreDispatch();
  const count = useStoreSelector((state) =>
    Object.hasOwn(state.agentProcesses, appSessionId)
      ? state.agentProcesses[appSessionId].length
      : 0,
  );
  if (count === 0) return null;
  const label = `${String(count)} background ${count === 1 ? 'process' : 'processes'}`;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-testid="background-line"
      aria-label={`${label}. Open the Background tab`}
      onClick={() => {
        dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'background', appSessionId });
      }}
      className="ml-1 min-w-0 text-muted"
    >
      <span className="motion-safe:animate-breathe">{label}</span>
    </Button>
  );
}
