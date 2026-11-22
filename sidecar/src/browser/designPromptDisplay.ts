import { readFileSync } from 'node:fs';
import {
  browserTranscriptReferencesFromDesignReferences,
  type BrowserTranscriptReference,
} from '@droidex/protocol';
import type { DesignPromptPack } from './types.js';
import { isBrowserAssetPath } from './browserPaths.js';
import { appPromptDisplayFromText } from '../appPrompt.js';
import { sideChatPromptDisplayFromText } from '../sideChatPrompt.js';
import { sideChatRepliesFromPrompt } from '../sideChatReplies.js';

export interface DesignPromptDisplay {
  text: string;
  browserRefs?: BrowserTranscriptReference[];
  sideChatReplies?: string[];
}

const PACK_PATH_RE = /^- References JSON:\s*(.+)$/m;
const INSTRUCTION_RE = /\nUser instruction:\n([\s\S]*)$/;

export function designPromptDisplayFromText(
  text: string,
  options: { browserDataDir?: string } = {},
): DesignPromptDisplay | null {
  if (!text.startsWith('Design Mode reference pack:')) return null;
  const framed = INSTRUCTION_RE.exec(text)?.[1]?.trim() ?? text.trim();
  // The instruction is framed as its chat sends text: an App request or a
  // side-chat question. The chat shows only what the user wrote.
  const instruction =
    appPromptDisplayFromText(framed) ?? sideChatPromptDisplayFromText(framed) ?? framed;
  // Side-chat replies sent with a framed instruction sit inside the frame.
  const replies = sideChatRepliesFromPrompt(instruction);
  const browserRefs = readBrowserRefsFromPack(text, options.browserDataDir);
  return {
    text: replies?.text ?? instruction,
    browserRefs: browserRefs.length ? browserRefs : undefined,
    sideChatReplies: replies?.sideChatReplies,
  };
}

// The marks of the pack the prompt names, when it is one of the browser's own.
function readBrowserRefsFromPack(
  text: string,
  browserDataDir: string | undefined,
): BrowserTranscriptReference[] {
  const packPath = PACK_PATH_RE.exec(text)?.[1]?.trim();
  if (!packPath || !isBrowserAssetPath(packPath, browserDataDir)) return [];
  try {
    const pack = JSON.parse(readFileSync(packPath, 'utf8')) as Partial<DesignPromptPack>;
    if (!Array.isArray(pack.references)) return [];
    return browserTranscriptReferencesFromDesignReferences(pack.references);
  } catch {
    return [];
  }
}
