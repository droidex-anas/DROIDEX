import { useState } from 'react';
import type { TranscriptEvent } from '../../types/bridge';
import { stripAnsi, toolArgString } from '../../lib/tools';
import { SkillIcon } from '../icons/SkillIcon';
import { Caret, ErrorTag, Expand, InterruptedTag } from './primitives';
import { ToolCallCard } from './commandCard';

function skillName(args: unknown): string | undefined {
  return (
    toolArgString(args, 'skill') ?? toolArgString(args, 'skillName') ?? toolArgString(args, 'name')
  );
}

/* ── Skill invocation: the skill's rosette and name in the skill blue, with
   what it was asked as quiet text. The body shows what the skill answered —
   never the raw JSON arguments, which read as a terminal dump of the skill's
   whole prompt. ── */
export function SkillCard({
  event,
  output,
  images,
  error = false,
  interrupted = false,
  running = false,
  forceOpen = false,
}: {
  event: TranscriptEvent;
  output?: string;
  images?: string[];
  error?: boolean;
  interrupted?: boolean;
  running?: boolean;
  forceOpen?: boolean;
}) {
  const name = skillName(event.toolArgs);
  const detail = toolArgString(event.toolArgs, 'args');
  const out = output ? stripAnsi(output).trimEnd() : '';
  const collapsible = out.length > 0 || Boolean(images?.length);
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;
  const label = (
    <>
      <SkillIcon className="size-icon-sm shrink-0" />
      {running ? (
        <span className="shimmer-text shrink-0 font-medium">Skill</span>
      ) : (
        <span className="shrink-0 text-secondary">Skill</span>
      )}
      {name ? <span className="min-w-0 truncate font-medium text-skill">{name}</span> : null}
      {detail ? <span className="min-w-0 truncate text-muted">{detail}</span> : null}
    </>
  );
  const tags = <>{interrupted ? <InterruptedTag /> : error && <ErrorTag />}</>;
  if (!collapsible) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-body">
        {label}
        {tags}
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="group flex w-full min-w-0 items-center gap-1.5 text-left text-body"
        aria-expanded={expanded}
      >
        {label}
        <Caret open={expanded} />
        {tags}
      </button>
      <Expand open={expanded}>
        <div className="mt-1.5 pl-5">
          <ToolCallCard heading={null} output={out} images={images} error={error} />
        </div>
      </Expand>
    </div>
  );
}
