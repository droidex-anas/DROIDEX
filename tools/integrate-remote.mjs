// Apply the small integration edits against the inspected repository, failing
// closed on changed anchors. The build workflow commits these edits on the
// integration branch; a checkout of that resulting commit needs no patch step.
import { readFileSync, writeFileSync } from 'node:fs';
function edit(path, marker, transform) {
  const source = readFileSync(path, 'utf8');
  if (source.includes(marker)) return;
  const once = (text, needle, replacement) => {
    if (text.split(needle).length !== 2) throw new Error(`${path}: integration anchor changed: ${needle.slice(0, 100)}`);
    return text.replace(needle, replacement);
  };
  const result = transform(source, once);
  if (!result.includes(marker)) throw new Error(`${path}: missing integration marker`);
  writeFileSync(path, result);
}
edit('electron/main.cjs', 'const remoteControl =', (source, once) => {
  source = once(source, 'let mainWindow = null;', `let mainWindow = null;
const remoteControl = require('./remote/control.cjs').createRemoteControl({
  app, Menu, dialog, clipboard, shell,
  supervisor: sidecarSupervisor,
  getMainWindow: () => mainWindow,
});`);
  return once(source, '  registerIpc();', '  remoteControl.installMenu();\n  registerIpc();');
});
edit('sidecar/src/SessionManager.ts', 'async remoteSessions()', (source, once) => once(source,
  '  async runtimeSnapshot(): Promise<BridgeRuntimeSnapshot> {',
  `  // Read-only remote queries must not change the desktop sidebar filter or
  // fan history replacements out to unrelated desktop/browser views.
  async remoteSessions(): Promise<SessionSummary[]> {
    await this.sessionFiles.whenBootReconciled();
    await this.adoption.adopt();
    return this.registry.listSummaries().sessions;
  }

  async remoteHistory(appSessionId: string, cursor?: string) {
    await this.sessionFiles.whenBootReconciled();
    return this.timeline.remoteHistory(appSessionId, cursor);
  }

  async runtimeSnapshot(): Promise<BridgeRuntimeSnapshot> {`));
edit('sidecar/src/SessionTimeline.ts', 'remoteHistory(appSessionId:', (source, once) => once(source,
  '  private loadStandard(',
  `  // Same canonical loader as the desktop, with a private reply. Flush the
  // local transcript writer before taking the snapshot/live-stream boundary.
  remoteHistory(appSessionId: string, cursor?: string): SessionHistoryPage {
    const summary = this.dependencies.registry.resolveSummary(appSessionId);
    if (!summary || summary.appSessionId !== appSessionId) throw new Error('Session is unavailable.');
    this.streaming.flushSource(appSessionId, appSessionId);
    this.transcripts.flush(appSessionId);
    const history = summary.sessionPurpose === 'mission-control'
      ? this.loaders.hydrateMission(appSessionId, historyWindowOptions(cursor, 80))
      : this.loadStandard(appSessionId, summary.providerSessionId ?? appSessionId, cursor, 80);
    return {
      appSessionId, progress: [],
      transcripts: history.transcripts.map((event) => ({ ...event, appSessionId })),
      mode: cursor ? 'prepend' : 'replace',
      ...(history.olderCursor ? { olderCursor: history.olderCursor } : {}),
    };
  }

  private loadStandard(`));
const request = `  | {
      type: 'remote.request';
      requestId: string;
      op: 'list' | 'history' | 'send' | 'stop';
      sessionId?: string;
      cursor?: string;
      text?: string;
      epoch?: string;
      commandId?: string;
      expiresAt?: number;
    }\n`;
const reply = `  | { type: 'remote.reply'; requestId: string; ok: boolean; value?: unknown; error?: string }\n`;
for (const path of ['sidecar/src/protocol.ts', 'src/types/bridge.ts']) {
  edit(path, "type: 'remote.request'", (source, once) => {
    source = once(source, 'export type ClientCommand =\n', 'export type ClientCommand =\n' + request);
    return once(source, 'export type ServerEvent =\n', 'export type ServerEvent =\n' + reply);
  });
}
edit('sidecar/src/index.ts', 'const remoteRequests =', (source, once) => {
  source = "import { createRemoteRequests } from './remote/requests.js';\n" + source;
  source = once(source, '  onCommand: async (command) => {', '  onCommand: async (command) => {\n    if (await remoteRequests(command)) return;');
  return once(source, '\nautomationManager = configureAutomationManager({', '\nconst remoteRequests = createRemoteRequests(manager, (event) => server.broadcast(event));\n\nautomationManager = configureAutomationManager({');
});
