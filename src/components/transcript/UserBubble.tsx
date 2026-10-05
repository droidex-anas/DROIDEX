import type { ComponentType, ReactNode } from 'react';
import { MessageThread } from '@droidex/icons';
import type { TranscriptEvent } from '../../types/bridge';
import type { OpenReviewFileHandler } from '../../lib/reviewFocus';
import { ImageAttachmentChip } from '../media/ImageAttachmentChip';
import { FileChip } from '../composer/FileChip';
import { isImagePath } from '../../lib/localImage';
import { isTempStoreAttachment } from '../../lib/fileKind';
import { promptDisplayParts } from '../../lib/composePrompt';
import { userMessageAttachments } from '../../lib/promptMentions';
import { BrowserReferenceChip } from '../browser/BrowserReferenceChip';
import { SkillIcon } from '../icons/SkillIcon';
import { VisualizeIcon } from '../icons/VisualizeIcon';
import { Markdown } from '../Markdown';
import { SpokenMark } from './primitives';
import { PromptActions } from './ResponseActions';
import { ClampedBlock } from './ClampedBlock';

function PromptChip({
  icon: Icon,
  label,
  title,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  title?: string;
}) {
  return (
    <span
      title={title ?? label}
      className="inline-flex items-center gap-1.5 font-medium text-droid-skill"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </span>
  );
}

// 14px text at 1.6 leading, matching the markdown shell.
const PROMPT_LINE_PX = 22.4;

function ClampedPrompt({ source, chips }: { source: string; chips: ReactNode }) {
  return (
    <ClampedBlock
      lines={16}
      lineHeightPx={PROMPT_LINE_PX}
      fade="from-droid-elevated via-droid-elevated/90"
      contentClassName={
        chips
          ? // The first paragraph runs inline after the chips, as it does in the
            // composer draft, so a short prompt shares their line.
            'flow-root [&>.md-shell>p:first-child]:inline [&>.md-shell]:inline'
          : 'flow-root'
      }
    >
      {chips}
      <Markdown authored>{source}</Markdown>
    </ClampedBlock>
  );
}

// Review reads a file through the workspace root, so a pasted or dropped
// attachment — which lives in the temp store outside it — stays a plain chip.
export function UserBubble({
  event,
  onOpenReviewFile,
  onSendNow,
  onWithdraw,
}: {
  event: Pick<
    TranscriptEvent,
    'text' | 'skills' | 'files' | 'browserRefs' | 'spoken' | 'sideChatReplies'
  > & {
    ts?: number;
  };
  onOpenReviewFile?: OpenReviewFileHandler;
  // Set on a steer the model has not taken in yet.
  onSendNow?: () => void;
  onWithdraw?: (() => void) | undefined;
}) {
  const browserRefs = event.browserRefs ?? [];
  // A replayed message has no files metadata, only the composed text it was sent
  // as, so attachments are recovered from its trailing @mention block.
  const message = userMessageAttachments(event.text, event.files);
  const display = promptDisplayParts(message.text, event.skills);
  const hasAttachments = message.files.length > 0 || browserRefs.length > 0;
  const replyCount = event.sideChatReplies?.length ?? 0;
  const hasChips = display.skills.length > 0 || display.visualize || replyCount > 0;
  const hasPrompt = Boolean(display.text) || hasChips;
  const chips = hasChips ? (
    // Top-aligned because the icon, not the label, would set the row's baseline.
    <span
      className={`inline-flex flex-wrap items-center gap-x-2 align-top${display.text ? ' mr-2' : ''}`}
    >
      {replyCount > 0 && (
        <PromptChip
          icon={MessageThread}
          label={replyCount === 1 ? '1 message' : `${String(replyCount)} messages`}
          title="Answers attached from the side chat"
        />
      )}
      {display.visualize && <PromptChip icon={VisualizeIcon} label="Visualize" />}
      {display.skills.map((skill) => (
        <PromptChip key={skill} icon={SkillIcon} label={skill} title={`Skill: ${skill}`} />
      ))}
    </span>
  ) : null;
  return (
    <div className="group/msg flex flex-col items-end gap-1.5">
      {event.spoken && <SpokenMark />}
      {hasAttachments && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
          {browserRefs.map((reference) => (
            <BrowserReferenceChip key={`${reference.kind}:${reference.id}`} reference={reference} />
          ))}
          {message.files.map((f) =>
            isImagePath(f) ? (
              <ImageAttachmentChip key={f} path={f} />
            ) : (
              <FileChip
                key={f}
                path={f}
                {...(onOpenReviewFile && !isTempStoreAttachment(f)
                  ? {
                      onOpen: () => {
                        onOpenReviewFile(f);
                      },
                    }
                  : {})}
              />
            ),
          )}
        </div>
      )}
      {hasPrompt && (
        <div className="relative min-w-0 max-w-[80%]">
          <div className="min-w-0 rounded-2xl rounded-br-sm bg-[var(--prompt-bubble-bg,var(--droid-elevated))] px-4 py-2.5 text-[14px] leading-[1.6] text-droid-text">
            {display.text ? <ClampedPrompt source={display.text} chips={chips} /> : chips}
          </div>
          {/* The pending preview of a first message has no ts, and no actions yet;
              a pending steer has actions but no time. */}
          {message.text && (event.ts !== undefined || onSendNow) ? (
            <PromptActions
              text={message.text}
              ts={event.ts}
              onSendNow={onSendNow}
              onWithdraw={onWithdraw}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
