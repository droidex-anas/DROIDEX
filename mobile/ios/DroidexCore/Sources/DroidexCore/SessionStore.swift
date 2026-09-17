import Foundation
import Observation

@MainActor
@Observable
public final class SessionStore {
    public enum LoadState: Equatable { case loading, ready, failed(String) }
    public static let promptLimit = 8_000

    public private(set) var sessions: [AgentSession] = []
    public private(set) var loadState: LoadState = .loading
    public private(set) var storageError: String?
    public private(set) var models: [RemoteModel] = []
    public private(set) var computerName = ""
    public private(set) var workspaceName = ""
    public private(set) var isConnected = false
    public private(set) var connectionError: String?
    public private(set) var lastSyncedAt: Date?
    public private(set) var sync = RemoteSync(state: "loading", message: "Loading recent sessions")
    public var canSend: Bool { loadState == .ready && isConnected }
    public var isConnecting: Bool { loading }
    public private(set) var pendingDeliveries: [UUID: PendingDelivery] = [:]
    public private(set) var actionErrors: [UUID: String] = [:]
    public private(set) var pendingActions: Set<UUID> = []
    public internal(set) var cachedChanges: ReviewSnapshot?
    public internal(set) var changesSyncedAt: Date?
    internal var cachedPullRequests: [RemotePullRequest]?
    internal var cachedPullRequestReviews: [Int: PullRequestReview] = [:]

    @ObservationIgnored let desktop: any DesktopService
    @ObservationIgnored private let expectedComputerID: UUID?
    @ObservationIgnored private let archive: RemoteArchive?
    @ObservationIgnored private var restoredCache = false
    @ObservationIgnored private var restoringCache = false
    @ObservationIgnored private var subscription: Task<Void, Never>?
    @ObservationIgnored var remoteGeneration = 0
    @ObservationIgnored private var remoteRevisions: [UUID: Int] = [:]
    @ObservationIgnored private var knownRemoteIDs: Set<UUID> = []
    @ObservationIgnored private var configurationDrafts: Set<UUID> = []
    @ObservationIgnored private var pendingSave: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    private var loading = false

    public init(desktop: any DesktopService, archiveURL: URL? = nil, computerID: UUID? = nil) {
        self.desktop = desktop
        self.expectedComputerID = computerID
        self.archive = archiveURL.map { RemoteArchive(url: $0, computerID: computerID) }
    }

    public func load() async {
        guard !restoringCache else { return }
        if !restoredCache {
            restoringCache = true
            let generation = remoteGeneration
            do {
                let saved = try await archive?.load()
                guard generation == remoteGeneration, !Task.isCancelled else { restoringCache = false; return }
                if let saved {
                    sessions = saved.sessions
                    models = saved.models
                    computerName = saved.computerName
                    workspaceName = saved.workspace
                    lastSyncedAt = saved.lastSyncedAt
                    knownRemoteIDs = saved.knownRemoteIDs
                    configurationDrafts = saved.configurationDrafts
                    cachedChanges = saved.changes
                    changesSyncedAt = saved.changesSyncedAt
                    cachedPullRequests = saved.pullRequests
                    cachedPullRequestReviews = saved.pullRequestReviews
                    pendingDeliveries = saved.deliveries.mapValues {
                        PendingDelivery(request: $0.request, state: .uncertain)
                    }
                }
            } catch {
                storageError = "Saved content could not be opened. It has not been replaced. " + error.localizedDescription
            }
            restoredCache = true
            restoringCache = false
            loadState = .ready
        }
        if !isConnected { await reconnect() }
    }

    public func session(_ id: UUID) -> AgentSession? {
        sessions.first { $0.appSessionId == id }
    }

    @discardableResult
    public func createSession(title: String = "New session", configuration: SessionConfiguration = .init()) -> UUID? {
        guard loadState == .ready else { return nil }
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let session = AgentSession(title: title.isEmpty ? "New session" : String(title.prefix(80)),
                                   workspace: workspaceName, configuration: configuration)
        sessions.insert(session, at: 0)
        scheduleSave()
        return session.id
    }

    public func setDraft(_ text: String, for id: UUID) {
        guard let index = index(of: id) else { return }
        sessions[index].draft = text
        scheduleSave()
    }

    public func configure(_ id: UUID, with configuration: SessionConfiguration) {
        guard let index = index(of: id), pendingDeliveries[id] == nil else { return }
        sessions[index].configuration = configuration
        configurationDrafts.insert(id)
        scheduleSave()
    }

    public func delete(_ id: UUID) {
        if knownRemoteIDs.contains(id) {
            performRemote(in: id) { [desktop] in try await desktop.remove(id) }
        } else if pendingDeliveries[id] != nil || session(id)?.phase.isRunning == true {
            connectionError = "Wait for the computer to acknowledge this session, or reconnect before closing it."
        } else {
            sessions.removeAll { $0.id == id }
            scheduleSave()
        }
    }

    @discardableResult
    public func send(_ text: String, to id: UUID) -> Task<Void, Never>? {
        sendRemote(text, to: id)
    }

    public func stop(_ id: UUID) {
        performRemote(in: id) { [desktop] in try await desktop.stop(id) }
    }

    public func respond(to approvalID: UUID, in id: UUID, allow: Bool) {
        performRemote(in: id) { [desktop] in try await desktop.approve(approvalID, in: id, allow: allow) }
    }

    public func answer(_ questionID: UUID, in sessionID: UUID, answers: [String]) {
        performRemote(in: sessionID) { [desktop] in try await desktop.answer(questionID, in: sessionID, answers: answers) }
    }

    public func suspend() async {
        for id in pendingDeliveries.keys { pendingDeliveries[id]?.state = .uncertain }
        remoteGeneration += 1
        subscription?.cancel()
        subscription = nil
        pendingActions.removeAll()
        loading = false
        isConnected = false
        await flush()
    }

    @discardableResult
    public func flush() async -> Bool {
        pendingSave?.cancel()
        pendingSave = nil
        revision += 1
        return await persist(revision: revision)
    }

    internal func scheduleSave() {
        guard loadState == .ready, archive != nil else { return }
        revision += 1
        guard pendingSave == nil else { return }
        pendingSave = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(300)) }
            catch { return }
            guard let self, !Task.isCancelled else { return }
            let savingRevision = self.revision
            _ = await self.persist(revision: savingRevision)
            guard !Task.isCancelled else { return }
            self.pendingSave = nil
            if self.revision != savingRevision { self.scheduleSave() }
        }
    }

    private func persist(revision: Int) async -> Bool {
        guard loadState == .ready, let archive else { return true }
        let saved = RemoteArchive.Snapshot(
            computerID: expectedComputerID, computerName: computerName, workspace: workspaceName,
            sessions: sessions, models: models, lastSyncedAt: lastSyncedAt,
            knownRemoteIDs: knownRemoteIDs, configurationDrafts: configurationDrafts,
            deliveries: pendingDeliveries, changes: cachedChanges, changesSyncedAt: changesSyncedAt,
            pullRequests: cachedPullRequests, pullRequestReviews: cachedPullRequestReviews
        )
        do {
            try await archive.save(saved, revision: revision)
            if self.revision == revision { storageError = nil }
            return true
        } catch {
            if self.revision == revision { storageError = "Recent content is in memory but could not be saved. " + error.localizedDescription }
            return false
        }
    }

    private func index(of id: UUID) -> Int? { sessions.firstIndex { $0.id == id } }

    public func reconnect() async {
        guard !loading else { return }
        loading = true
        remoteGeneration += 1
        let generation = remoteGeneration
        subscription?.cancel()
        isConnected = false
        connectionError = nil
        do {
            let bootstrap = try await desktop.bootstrap()
            guard remoteGeneration == generation, !Task.isCancelled else {
                if remoteGeneration == generation { loading = false }
                return
            }
            guard bootstrap.version == 3 else { throw RemoteFailure("Update both DROIDEX apps to the same remote protocol version.") }
            if let expectedComputerID, bootstrap.computerId != expectedComputerID {
                throw RemoteFailure("This is a different computer. Pair again before continuing.")
            }
            computerName = bootstrap.computerName
            workspaceName = bootstrap.workspace
            models = bootstrap.models
            sync = bootstrap.sync ?? RemoteSync(state: "loading", message: "Loading recent desktop sessions")
            replaceRemote(bootstrap.sessions)
            loadState = .ready
            subscription = Task { [weak self, desktop] in
                do {
                    for try await event in desktop.updates() {
                        guard let self, self.remoteGeneration == generation, !Task.isCancelled else { return }
                        self.receive(event)
                    }
                    guard let self, self.remoteGeneration == generation, !Task.isCancelled else { return }
                    self.loading = false
                    self.isConnected = false
                    self.connectionError = "The computer connection ended. Reconnect to see the latest state. Work may still be running on your computer."
                } catch {
                    guard let self, self.remoteGeneration == generation, !Task.isCancelled else { return }
                    self.loading = false
                    self.isConnected = false
                    self.connectionError = error.localizedDescription
                }
            }
        } catch {
            guard remoteGeneration == generation, !Task.isCancelled else { return }
            loading = false
            connectionError = error.localizedDescription
            loadState = .ready
        }
    }

    private func receive(_ event: RemoteEvent) {
        switch event {
        case .snapshot(let values):
            replaceRemote(values)
            loading = false
            isConnected = true
            connectionError = nil
        case .session(let value): applyRemote(value)
        case .removed(let id):
            configurationDrafts.remove(id)
            pendingDeliveries.removeValue(forKey: id)
            actionErrors.removeValue(forKey: id)
            pendingActions.remove(id)
            sessions.removeAll { $0.id == id }
            remoteRevisions.removeValue(forKey: id)
            knownRemoteIDs.remove(id)
        case .catalog(let values): models = values
        case .sync(let value): sync = value
        case .heartbeat: return
        }
        lastSyncedAt = .now
        scheduleSave()
    }

    private func replaceRemote(_ values: [RemoteSession]) {
        let incoming = Set(values.map(\.id))
        for value in values { applyRemote(value, authoritative: true) }
        knownRemoteIDs.formUnion(incoming)
    }

    private func applyRemote(_ value: RemoteSession, authoritative: Bool = false) {
        if !authoritative, let previous = remoteRevisions[value.id], previous >= value.revision { return }
        if let pending = pendingDeliveries[value.id], value.lastRequestId == pending.request.requestId {
            pendingDeliveries.removeValue(forKey: value.id)
            actionErrors.removeValue(forKey: value.id)
            if let index = index(of: value.id), sessions[index].draft.trimmingCharacters(in: .whitespacesAndNewlines) == pending.request.prompt {
                sessions[index].draft = ""
            }
        }
        let existing = session(value.id)
        var replacement = value.localSession(draft: existing?.draft ?? "")
        if let existing, value.historyState == "unloaded" || value.historyState == "loading" {
            replacement.messages = existing.messages
            replacement.changes = existing.changes
            replacement.diffNote = existing.diffNote
        }
        // Idle diff refreshes must not erase the user's choice for their next turn.
        if let existing, configurationDrafts.contains(value.id), existing.phase.canSend, replacement.phase.canSend {
            replacement.configuration = existing.configuration
        }
        if let index = index(of: value.id) { sessions[index] = replacement }
        else { sessions.insert(replacement, at: 0) }
        knownRemoteIDs.insert(value.id)
        remoteRevisions[value.id] = value.revision
    }

    private func sendRemote(_ text: String, to id: UUID) -> Task<Void, Never>? {
        guard let index = index(of: id), sessions[index].phase.canSend,
              pendingDeliveries[id] == nil else { return nil }
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let configuration = sessions[index].configuration
        if let error = submissionError(prompt, configuration: configuration) {
            actionErrors[id] = error
            return nil
        }
        guard let modelID = configuration.remoteModelID,
              let model = models.first(where: { $0.id == modelID }) else { return nil }
        let request = RemoteTurn(id: id, prompt: prompt, modelId: modelID,
                                 effort: model.efforts.isEmpty ? nil : configuration.remoteEffort,
                                 mode: configuration.interactionMode)
        configurationDrafts.remove(id)
        actionErrors.removeValue(forKey: id)
        pendingDeliveries[id] = PendingDelivery(request: request, state: .sending)
        sessions[index].draft = text
        sessions[index].phase = .waiting
        if sessions[index].title == "New session" { sessions[index].title = String(prompt.prefix(60)) }
        scheduleSave()
        let generation = remoteGeneration
        return Task { [weak self, desktop] in
            do {
                // Save the receipt identity before a command can reach the computer.
                guard let self else { return }
                let saved = await self.flush()
                guard self.remoteGeneration == generation, !Task.isCancelled else { return }
                if !saved {
                    self.pendingDeliveries.removeValue(forKey: id)
                    if let index = self.index(of: id) { self.sessions[index].phase = .ready }
                    self.actionErrors[id] = "Could not save this message safely. " + (self.storageError ?? "Check available device storage.")
                    self.scheduleSave()
                    return
                }
                try await desktop.send(request)
                guard self.remoteGeneration == generation,
                      self.pendingDeliveries[id]?.request.requestId == request.requestId else { return }
                self.pendingDeliveries[id]?.state = .accepted
                self.scheduleSave()
            } catch {
                guard let self, self.remoteGeneration == generation,
                      self.pendingDeliveries[id]?.request.requestId == request.requestId else { return }
                if let failure = error as? RemoteFailure, failure.wasRejected {
                    self.pendingDeliveries.removeValue(forKey: id)
                    self.actionErrors[id] = failure.localizedDescription
                    if let index = self.index(of: id), self.sessions[index].phase == .waiting {
                        self.sessions[index].phase = .ready
                    }
                    if failure.statusCode == 401 || failure.statusCode == 403 {
                        self.loading = false
                        self.isConnected = false
                        self.connectionError = "Pair with this computer again to continue."
                    }
                } else {
                    self.pendingDeliveries[id]?.state = .uncertain
                    self.loading = false
                    self.isConnected = false
                    self.connectionError = "Delivery is unconfirmed. Reconnect and check the conversation before retrying. Your message was not automatically resent."
                }
            }
            self?.scheduleSave()
        }
    }

    public func discardUnconfirmedDelivery(_ id: UUID) {
        guard pendingDeliveries[id]?.state == .uncertain else { return }
        pendingDeliveries.removeValue(forKey: id)
        if let index = index(of: id), sessions[index].phase == .waiting { sessions[index].phase = .ready }
        scheduleSave()
    }

    public func refreshRemote() async {
        guard isConnected else { await reconnect(); return }
        let generation = remoteGeneration
        do { try await desktop.refresh() }
        catch { if remoteGeneration == generation { connectionError = error.localizedDescription } }
    }

    public func loadRemoteHistory(_ id: UUID) {
        guard isConnected else { return }
        performRemote(in: id) { [desktop] in try await desktop.loadHistory(id) }
    }

    private func performRemote(in id: UUID, _ action: @escaping @MainActor () async throws -> Void) {
        guard isConnected else { actionErrors[id] = "Reconnect to your computer before taking this action."; return }
        guard !pendingActions.contains(id) else { return }
        actionErrors.removeValue(forKey: id)
        pendingActions.insert(id)
        let generation = remoteGeneration
        Task { [weak self] in
            defer { if self?.remoteGeneration == generation { self?.pendingActions.remove(id) } }
            do { try await action() }
            catch {
                guard let self, self.remoteGeneration == generation else { return }
                self.actionErrors[id] = error.localizedDescription
            }
        }
    }
}
