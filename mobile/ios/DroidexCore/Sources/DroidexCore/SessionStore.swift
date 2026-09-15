import Foundation
import Observation

@MainActor
@Observable
public final class SessionStore {
    public enum LoadState: Equatable { case loading, ready, failed(String) }

    public private(set) var sessions: [AgentSession] = []
    public private(set) var loadState: LoadState = .loading
    public private(set) var storageError: String?
    public static let promptLimit = 8_000

    @ObservationIgnored private let client: any AgentClient
    @ObservationIgnored private let archive: SessionArchive?
    @ObservationIgnored private var runs: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private var pendingSave: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var loading = false

    public init(client: any AgentClient = DemoAgentClient(), archiveURL: URL? = nil) {
        self.client = client
        self.archive = archiveURL.map(SessionArchive.init)
    }

    public func load() async {
        guard loadState != .ready, !loading else { return }
        loading = true
        loadState = .loading
        defer { loading = false }
        do {
            sessions = try await archive?.load() ?? DemoContent.sessions()
            loadState = .ready
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    public func session(_ id: UUID) -> AgentSession? {
        sessions.first { $0.appSessionId == id }
    }

    @discardableResult
    public func createSession(title: String = "New session", configuration: SessionConfiguration = .init()) -> UUID? {
        guard loadState == .ready else { return nil }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let session = AgentSession(
            title: trimmedTitle.isEmpty ? "New session" : String(trimmedTitle.prefix(80)),
            configuration: configuration
        )
        sessions.insert(session, at: 0)
        scheduleSave()
        return session.appSessionId
    }

    public func setDraft(_ text: String, for id: UUID) {
        guard let index = index(of: id) else { return }
        sessions[index].draft = text
        scheduleSave(after: .milliseconds(400))
    }

    public func configure(_ id: UUID, with configuration: SessionConfiguration) {
        guard let index = index(of: id), sessions[index].phase.canSend else { return }
        sessions[index].configuration = configuration
        scheduleSave()
    }

    public func rename(_ id: UUID, to title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let index = index(of: id) else { return }
        sessions[index].title = String(title.prefix(80))
        scheduleSave()
    }

    public func delete(_ id: UUID) {
        stop(id)
        sessions.removeAll { $0.appSessionId == id }
        scheduleSave()
    }

    @discardableResult
    public func send(_ text: String, to id: UUID) -> Task<Void, Never>? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard loadState == .ready, !text.isEmpty, text.count <= Self.promptLimit,
              let index = index(of: id), sessions[index].phase.canSend else { return nil }
        let runID = UUID()
        let response = ChatMessage(role: .assistant, text: "")
        let request = TurnRequest(appSessionId: id, text: text, configuration: sessions[index].configuration)
        sessions[index].messages += [.init(role: .user, text: text), response]
        sessions[index].phase = .running(runID)
        sessions[index].draft = ""
        sessions[index].changes = []
        sessions[index].updatedAt = .now
        if sessions[index].title == "New session" { sessions[index].title = String(text.prefix(60)) }
        scheduleSave()
        let events = client.events(for: request)
        let task = Task { [weak self] in
            do {
                for try await event in events {
                    guard !Task.isCancelled, let self, self.isCurrent(id, runID: runID) else { return }
                    if self.apply(event, to: id, responseID: response.id) { return }
                }
                guard let self, self.isCurrent(id, runID: runID) else { return }
                self.fail(id, message: "The preview ended without a result. Please send the message again.")
            } catch {
                guard let self, self.isCurrent(id, runID: runID) else { return }
                if error is CancellationError {
                    self.stop(id)
                } else {
                    self.fail(id, message: "The preview could not finish. Please send the message again.")
                }
            }
        }
        runs[id] = task
        return task
    }

    public func stop(_ id: UUID) {
        guard let index = index(of: id), sessions[index].phase.isRunning else { return }
        // Invalidate first: cancellation may still allow buffered events to arrive.
        sessions[index].phase = .stopped
        let task = runs.removeValue(forKey: id)
        task?.cancel()
        if sessions[index].messages.last?.text.isEmpty == true {
            sessions[index].messages[sessions[index].messages.count - 1].text = "Stopped before a response."
        }
        sessions[index].updatedAt = .now
        scheduleSave()
    }

    public func respond(to approvalID: UUID, in id: UUID, allow: Bool) {
        guard let index = index(of: id), sessions[index].phase.approval?.id == approvalID else { return }
        sessions[index].phase = allow ? .completed : .stopped
        let text = allow
            ? "Preview approved. No commands were run and no repository files were changed."
            : "Preview declined. No commands were run and no repository files were changed."
        sessions[index].messages.append(.init(role: .assistant, text: text))
        sessions[index].updatedAt = .now
        scheduleSave()
    }

    public func suspend() async {
        for id in Array(runs.keys) { stop(id) }
        await flush()
    }

    public func flush() async {
        scheduleSave()
        await pendingSave?.value
    }

    public func resetPreview() async {
        for id in Array(runs.keys) { stop(id) }
        sessions = DemoContent.sessions()
        loadState = .ready
        await flush()
    }

    private func index(of id: UUID) -> Int? { sessions.firstIndex { $0.appSessionId == id } }

    private func isCurrent(_ id: UUID, runID: UUID) -> Bool {
        session(id)?.phase == .running(runID)
    }

    private func apply(_ event: AgentEvent, to id: UUID, responseID: UUID) -> Bool {
        guard let index = index(of: id),
              let messageIndex = sessions[index].messages.firstIndex(where: { $0.id == responseID }) else { return true }
        switch event {
        case .step(let step): sessions[index].messages[messageIndex].steps.append(step)
        case .text(let text): sessions[index].messages[messageIndex].text += text
        case .changes(let changes): sessions[index].changes = changes
        case .approval(let approval): sessions[index].phase = .needsApproval(approval)
        case .completed: sessions[index].phase = .completed
        }
        let settled = !sessions[index].phase.isRunning
        if settled {
            runs.removeValue(forKey: id)
            sessions[index].updatedAt = .now
            scheduleSave()
        }
        return settled
    }

    private func fail(_ id: UUID, message: String) {
        guard let index = index(of: id) else { return }
        runs.removeValue(forKey: id)
        sessions[index].phase = .failed(message)
        sessions[index].updatedAt = .now
        scheduleSave()
    }

    private func scheduleSave(after delay: Duration = .zero) {
        guard loadState == .ready, let archive else { return }
        revision += 1
        let revision = revision
        let snapshot = sessions
        pendingSave?.cancel()
        pendingSave = Task { [weak self] in
            do {
                if delay != .zero { try await Task.sleep(for: delay) }
                try Task.checkCancellation()
                try await archive.save(snapshot, revision: revision)
                guard let self, self.revision == revision else { return }
                self.storageError = nil
            } catch is CancellationError {
                return
            } catch {
                guard let self, self.revision == revision else { return }
                self.storageError = "Your changes are in memory but could not be saved. Check available storage and try again."
            }
        }
    }
}
