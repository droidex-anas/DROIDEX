import { pathToFileURL } from 'node:url';
import type { ContentBlock, PromptCapabilities } from '@agentclientprotocol/sdk/unstable';
import type { ProviderMention } from '../catalog.js';

export interface DevinForkContext {
  sessionId: string;
  seed: string;
}

// A fork's earlier conversation rides as embedded context so the request stays
// the prompt's own text; ACP allows that block only when Devin advertises it.
export function devinPromptContent(
  prompt: string,
  mentions: readonly ProviderMention[] | undefined,
  fork: DevinForkContext | undefined,
  capabilities: PromptCapabilities | undefined,
): ContentBlock[] {
  const mentioned: ContentBlock[] = (mentions ?? []).map((mention) =>
    mention.path
      ? { type: 'resource_link', name: mention.name, uri: pathToFileURL(mention.path).href }
      : { type: 'text', text: `@${mention.name}` },
  );
  if (!fork) return [{ type: 'text', text: prompt }, ...mentioned];
  const context = `Conversation so far:\n${fork.seed}`;
  if (!capabilities?.embeddedContext)
    return [{ type: 'text', text: `${context}\n\nCurrent request:\n${prompt}` }, ...mentioned];
  return [
    {
      type: 'resource',
      resource: {
        uri: `droidex://fork-seed/${encodeURIComponent(fork.sessionId)}`,
        mimeType: 'text/markdown',
        text: context,
      },
    },
    { type: 'text', text: prompt },
    ...mentioned,
  ];
}
