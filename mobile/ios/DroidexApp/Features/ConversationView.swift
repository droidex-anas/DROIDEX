import DroidexCore
import SwiftUI

struct ConversationView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    let sessionID: UUID
    @State private var showReview = false
    @State private var renaming = false
    @State private var title = ""
    @State private var deleting = false
    @State private var confirmRetry = false
    @State private var atBottom = true
    @State private var followsLatest = true
    @State private var scrollPosition = ScrollPosition(edge: .bottom)

    var body: some View {
        if let session = store.session(sessionID) {
            conversation(session)
                .background(DroidTheme.background)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar(.visible, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 2) {
                            Text(session.title).font(.headline).lineLimit(1)
                            Text(store.modelName(session.configuration)).font(.caption2).foregroundStyle(DroidTheme.secondary).lineLimit(1)
                        }.accessibilityElement(children: .combine)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Changes") { showReview = true }.font(.subheadline).accessibilityIdentifier("review.open")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            if !store.isRemote { Button("Rename") { title = session.title; renaming = true } }
                            ShareLink("Share conversation", item: exportedConversation(session))
                            Button(store.isRemote ? "Close remote session" : "Delete session", role: .destructive) { deleting = true }
                        } label: { Label("Session actions", systemImage: "ellipsis") }
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    ComposerView(
                        text: Binding(get: { store.session(sessionID)?.draft ?? "" }, set: { store.setDraft($0, for: sessionID) }),
                        configuration: Binding(get: { store.session(sessionID)?.configuration ?? .init() }, set: { store.configure(sessionID, with: $0) }),
                        phase: store.pendingDeliveries[sessionID] == nil ? session.phase : .waiting,
                        send: {
                            if store.send(store.session(sessionID)?.draft ?? "", to: sessionID) != nil { jumpToLatest() }
                        },
                        stop: { store.stop(sessionID) }
                    )
                    .disabled(store.pendingActions.contains(sessionID))
                    .frame(maxWidth: 720).padding(.horizontal, 16).padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                }
                .sensoryFeedback(trigger: session.phase) { _, phase in
                    guard hapticsEnabled, scenePhase == .active else { return nil }
                    switch phase {
                    case .needsApproval, .needsAnswer: return .warning
                    case .completed: return .success
                    case .failed: return .error
                    case .stopped: return .selection
                    default: return nil
                    }
                }
                .task(id: sessionID) {
                    if store.isRemote, session.historyState == "unloaded" { store.loadRemoteHistory(sessionID) }
                }
                .sheet(isPresented: $showReview) { ReviewView(sessionID: sessionID) }
                .alert("Rename session", isPresented: $renaming) {
                    TextField("Title", text: $title)
                    Button("Cancel", role: .cancel) {}
                    Button("Save") { store.rename(sessionID, to: title) }
                }
                .confirmationDialog("Close this session?", isPresented: $deleting, titleVisibility: .visible) {
                    Button("Close session", role: .destructive) { store.delete(sessionID) }
                } message: {
                    Text(store.isRemote ? "Running work will stop. Edits are not undone and desktop history is retained." : "The local preview conversation will be removed.")
                }
                .confirmationDialog("Did you check the desktop?", isPresented: $confirmRetry, titleVisibility: .visible) {
                    Button("I checked — keep my draft") { store.discardUnconfirmedDelivery(sessionID) }
                } message: { Text("Your earlier message may have reached the computer. Retrying without checking can duplicate the work.") }
        } else {
            ContentUnavailableView("Session closed", systemImage: "tray")
        }
    }

    private func conversation(_ session: AgentSession) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 26) {
                historyStatus(session)
                ForEach(session.messages) { message in
                    ConversationMessage(message: message, isRunning: session.phase.isRunning && message.id == session.messages.last?.id)
                        .equatable().id(message.id)
                }
                if let pending = store.pendingDeliveries[sessionID] {
                    VStack(alignment: .trailing, spacing: 8) {
                        Text(pending.request.prompt).font(.body).textSelection(.enabled)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .background(DroidTheme.elevated, in: RoundedRectangle(cornerRadius: 20))
                        WorkingLabel(text: pending.state == .sending ? "Sending to computer…" : pending.state == .accepted ? "Accepted · opening turn…" : "Delivery unconfirmed", active: pending.state != .uncertain && store.isConnected)
                            .font(.footnote).foregroundStyle(DroidTheme.secondary)
                        if pending.state == .uncertain { Button("Review before retrying") { confirmRetry = true }.font(.footnote).frame(minHeight: 44) }
                    }.frame(maxWidth: .infinity, alignment: .trailing)
                } else if session.messages.isEmpty && session.phase.canSend {
                    Text("Ask about this project, or give your computer a task.")
                        .font(.callout).foregroundStyle(DroidTheme.secondary).padding(.top, 24)
                }
                if session.phase.isRunning, session.messages.last?.text.isEmpty != false,
                   session.messages.last?.activity?.isEmpty != false, session.messages.last?.steps.isEmpty != false {
                    HStack(spacing: 10) {
                        ActivityPulse()
                        WorkingLabel(text: "Waiting for \(store.modelName(session.configuration))", active: true)
                    }.font(.footnote).foregroundStyle(DroidTheme.secondary)
                }
                if !session.phase.isRunning && store.pendingDeliveries[sessionID] == nil { PhaseLabel(phase: session.phase) }
                if let error = store.actionErrors[sessionID] { Text(error).font(.callout).foregroundStyle(DroidTheme.danger) }
                if case .failed(let error) = session.phase { Text(error).font(.callout).foregroundStyle(DroidTheme.danger) }
                if !session.changes.isEmpty {
                    Button { showReview = true } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Review changes").font(.subheadline.weight(.medium))
                                Text("\(session.changes.count) files · \(store.isRemote ? "Working tree" : "Illustrative")").font(.caption).foregroundStyle(DroidTheme.secondary)
                            }
                            Spacer(minLength: 8)
                            DiffCounts(additions: session.additions, deletions: session.deletions)
                            Image(systemName: "chevron.right").font(.caption2)
                        }.padding(16).background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(.plain)
                }
                if let approval = session.phase.approval {
                    ApprovalCard(approval: approval, busy: store.pendingActions.contains(sessionID)) { store.respond(to: approval.id, in: sessionID, allow: $0) }
                        .id(approval.id)
                }
                if let question = session.phase.question {
                    QuestionCard(question: question, sessionID: sessionID).id(question.id).disabled(store.pendingActions.contains(sessionID))
                }
            }
            .frame(maxWidth: 680).padding(.horizontal, 22).padding(.vertical, 24).frame(maxWidth: .infinity)
        }
        .scrollPosition($scrollPosition)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.top, for: .alignment)
        .defaultScrollAnchor(followsLatest ? .bottom : nil, for: .sizeChanges)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.visibleRect.maxY >= geometry.contentSize.height - 64
        } action: { _, value in atBottom = value }
        .onScrollPhaseChange { _, phase in
            if phase == .tracking || phase == .interacting { followsLatest = false }
            if phase == .idle { followsLatest = atBottom }
        }
        .overlay(alignment: .bottomTrailing) {
            if !atBottom {
                Button(action: jumpToLatest) {
                    Image(systemName: "arrow.down").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                        .modifier(GlassChrome(cornerRadius: 22, interactive: true))
                }.buttonStyle(.plain).accessibilityLabel("Jump to latest message").padding(16)
            }
        }
    }

    @ViewBuilder private func historyStatus(_ session: AgentSession) -> some View {
        if store.isRemote, let state = session.historyState {
            if state == "loading" { ProgressView("Loading recent messages…").font(.footnote) }
            if let note = session.historyNote { Text(note).font(.footnote).foregroundStyle(DroidTheme.secondary) }
            if state != "ready" && state != "loading" && !session.phase.isRunning {
                Button("Load recent messages") { store.loadRemoteHistory(sessionID) }.font(.footnote).frame(minHeight: 44)
                    .disabled(store.pendingActions.contains(sessionID))
            }
        }
    }

    private func jumpToLatest() {
        followsLatest = true
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { scrollPosition.scrollTo(edge: .bottom) }
    }

    private func exportedConversation(_ session: AgentSession) -> String {
        "# \(session.title)\n\n" + session.messages.map { "## \($0.role == .user ? "You" : "DROIDEX")\n\n\($0.text)" }.joined(separator: "\n\n")
    }
}

private struct ConversationMessage: View, Equatable {
    let message: ChatMessage
    let isRunning: Bool

    var body: some View {
        if message.role == .user {
            Text(message.text).font(.body).textSelection(.enabled)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(DroidTheme.elevated, in: RoundedRectangle(cornerRadius: 20))
                .frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 32)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                BrandMark().frame(width: 68, height: 10).foregroundStyle(DroidTheme.secondary)
                if !message.steps.isEmpty || message.activity?.isEmpty == false {
                    AgentStepsView(steps: message.steps, activity: message.activity ?? [], isRunning: isRunning)
                }
                if !message.text.isEmpty { MarkdownContent(source: message.text) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
