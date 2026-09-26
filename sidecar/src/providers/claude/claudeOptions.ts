import { spawn, type ChildProcess } from 'node:child_process';
import type { EffortLevel, Options } from '@anthropic-ai/claude-agent-sdk';

import type { ReasoningEffort } from '../../protocol.js';
import type { ClaudeSessionInput } from './claudeSession.js';
import { childEnv } from '../../childEnv.js';
import { claudeCanUseTool, claudePermissionMode } from './claudePermissions.js';

export function sessionOptions(
  input: ClaudeSessionInput,
  abortController: AbortController,
  isPlanning: () => boolean,
  onSpawn: (process: ChildProcess) => void,
): Options {
  const effort = claudeEffort(input.reasoningEffort);
  return {
    abortController,
    cwd: input.cwd,
    pathToClaudeCodeExecutable: input.executable,
    ...(input.modelId ? { model: input.modelId } : {}),
    // The flag is written both ways: a settings file may carry ultracode too,
    // and the level the chip shows is the one the session must run at.
    ...(effort ? { effort: effort.effortLevel, settings: { ultracode: effort.ultracode } } : {}),
    ...(input.resume ? { resume: input.appSessionId } : { sessionId: input.appSessionId }),
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // 'project' is what loads the repository's CLAUDE.md.
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    mcpServers: input.mcpServers,
    // The Spec toggle owns plan mode, so the model may not enter it on its own:
    // at high autonomy bypassPermissions skips canUseTool altogether and a
    // refusal there would never run. ExitPlanMode stays available because it is
    // how the model hands its plan over, and plan mode always asks the callback.
    disallowedTools: ['EnterPlanMode'],
    permissionMode:
      input.interactionMode === 'spec'
        ? 'plan'
        : claudePermissionMode(input.autonomy === 'medium' ? 'off' : input.autonomy),
    // Consent to the bypass mode, not the mode itself: the CLI reads this flag
    // only as "this host may use bypassPermissions" and takes the mode from
    // permissionMode. Raising autonomy to high mid-session switches the mode
    // with setPermissionMode, which the CLI refuses without this.
    allowDangerouslySkipPermissions: true,
    canUseTool: claudeCanUseTool(input.appSessionId, input.interactions, isPlanning),
    // The SDK would otherwise own the subprocess privately; spawning it here is
    // what gives the session a pid for the agent-process monitor to track and
    // kill, the way it tracks Droid's.
    // This replaces the subprocess environment rather than adding to it, which
    // is why childEnv copies process.env: the CLI needs the user's PATH, HOME
    // and login, and only the app's own variables are left behind.
    env: childEnv(),
    // `env` below is the one set above, handed back unchanged.
    spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
      const child = spawn(command, args, {
        ...(cwd !== undefined ? { cwd } : {}),
        env,
        signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      // Nothing else reads stderr on this path, and a full pipe would stall the
      // CLI mid-turn.
      child.stderr.resume();
      onSpawn(child);
      return child;
    },
    // HOME is never overridden: on macOS it also relocates the login keychain,
    // and the CLI then reports the user as signed out.
  };
}

// DROIDEX's effort vocabulary is the union of every harness's; Claude Code
// takes the five levels it publishes and nothing else, so a level from another
// harness leaves the session on its own default rather than being coerced.
const CLAUDE_EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Ultra is the CLI's ultracode: xhigh effort plus standing workflow
// orchestration, carried as a session setting rather than a sixth level.
interface ClaudeEffort {
  effortLevel: EffortLevel;
  ultracode: boolean;
}

export function claudeEffort(effort: ReasoningEffort | undefined): ClaudeEffort | undefined {
  if (effort === 'ultra') return { effortLevel: 'xhigh', ultracode: true };
  const level = CLAUDE_EFFORTS.find((candidate) => candidate === effort);
  return level ? { effortLevel: level, ultracode: false } : undefined;
}
