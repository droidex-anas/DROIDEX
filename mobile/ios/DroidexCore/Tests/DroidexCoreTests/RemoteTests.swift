import Foundation
import Testing
@testable import DroidexCore

let computerID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!

@MainActor
func fixture(id: UUID? = nil, revision: Int = 2, phase: String = "completed", text: String = "The workspace is ready.", requestID: UUID? = nil) throws -> RemoteSession {
    let url = Bundle.module.url(forResource: "session", withExtension: "json", subdirectory: "Fixtures")!
    var object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    if let id { object["id"] = id.uuidString }
    if let requestID { object["lastRequestId"] = requestID.uuidString }
    object["revision"] = revision
    object["phase"] = phase
    var messages = object["messages"] as! [[String: Any]]
    messages[1]["text"] = text
    object["messages"] = messages
    if phase == "approval" {
        object["approval"] = ["id": UUID().uuidString, "title": "Run tests?", "detail": "swift test"]
    }
    if phase == "question" {
        object["question"] = ["id": UUID().uuidString, "questions": [["index": 3, "question": "Which target?", "options": ["App", "Core"]]]]
    }
    return try JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: object))
}

@MainActor
final class Desktop: DesktopService {
    var review: ReviewSnapshot?
    var bootstrapCount = 0
    var automaticSnapshot = true
    func changes() async throws -> ReviewSnapshot {
        guard let review else { throw RemoteFailure("Not configured for this test") }
        return review
    }
    func pullRequests() async throws -> [RemotePullRequest] { throw RemoteFailure("Not configured for this test") }
    func pullRequest(_ number: Int) async throws -> PullRequestReview { throw RemoteFailure("Not configured for this test") }

    var sessions: [RemoteSession] = []
    var models: [[String: Any]] = [["id": "test-model", "name": "Installed model", "efforts": ["low", "high"], "defaultEffort": "high"]]
    var refreshes = 0
    var historyRequests: [UUID] = []
    var sent: [RemoteTurn] = []
    var stops: [UUID] = []
    var approvals: [(UUID, UUID, Bool)] = []
    var answers: [(UUID, UUID, [String])] = []
    var removed: [UUID] = []
    var continuations: [AsyncThrowingStream<RemoteEvent, Error>.Continuation] = []
    var bootstrapError: Error?
    var sendError: Error?
    var beforeSendReturns: ((RemoteTurn) async throws -> Void)?

    func bootstrap() async throws -> RemoteBootstrap {
        bootstrapCount += 1
        if let bootstrapError { throw bootstrapError }
        let data = try JSONSerialization.data(withJSONObject: [
            "version": 3, "computerId": computerID.uuidString, "computerName": "Test computer", "workspace": "workspace",
            "models": models,
            "sessions": try JSONSerialization.jsonObject(with: JSONEncoder().encode(sessions)),
        ])
        return try JSONDecoder().decode(RemoteBootstrap.self, from: data)
    }
    func updates() -> AsyncThrowingStream<RemoteEvent, Error> {
        AsyncThrowingStream { continuation in
            continuations.append(continuation)
            if automaticSnapshot { continuation.yield(.snapshot(sessions)) }
        }
    }
    func send(_ turn: RemoteTurn) async throws { sent.append(turn); try await beforeSendReturns?(turn); if let sendError { throw sendError } }
    func stop(_ id: UUID) async throws { stops.append(id) }
    func approve(_ approvalID: UUID, in sessionID: UUID, allow: Bool) async throws { approvals.append((approvalID, sessionID, allow)) }
    func answer(_ questionID: UUID, in sessionID: UUID, answers: [String]) async throws { self.answers.append((questionID, sessionID, answers)) }
    func remove(_ id: UUID) async throws { removed.append(id) }
    func refresh() async throws { refreshes += 1 }
    func loadHistory(_ id: UUID) async throws { historyRequests.append(id) }
    func files(path: String, cursor: String?) async throws -> RemoteFilePage {
        try JSONDecoder().decode(RemoteFilePage.self, from: Data(#"{"path":"","entries":[]}"#.utf8))
    }
    func file(path: String) async throws -> RemoteFileContent { throw RemoteFailure("No fixture for this file") }
    func emit(_ event: RemoteEvent) { continuations.last?.yield(event) }
}

@MainActor
func drain() async { for _ in 0..<40 { await Task.yield() } }

@Suite @MainActor
struct RemoteTests {
    @Test func connectedStoreNeverLoadsBundledConversations() async throws {
        let desktop = Desktop()
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        #expect(store.isConnected)
        #expect(store.sessions.isEmpty)
        #expect(store.defaultConfiguration.remoteModelID == "test-model")
        #expect(store.defaultConfiguration.remoteEffort == "high")
        #expect(store.sessions.isEmpty)
        await store.suspend()
    }

    @Test func sendUsesRealCatalogSelectionAndDoesNotInventAResponse() async throws {
        let desktop = Desktop()
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        let id = try #require(store.createSession(configuration: store.defaultConfiguration))
        await store.send("Inspect the workspace", to: id)?.value
        #expect(desktop.sent.count == 1)
        #expect(desktop.sent.first?.modelId == "test-model")
        #expect(desktop.sent.first?.effort == "high")
        #expect(store.session(id)?.messages.isEmpty == true)
        desktop.emit(.session(try fixture(id: id)))
        await drain()
        #expect(store.session(id)?.messages.last?.text == "The workspace is ready.")
        #expect(store.session(id)?.phase == .completed)
        await store.suspend()
    }

    @Test func backgroundingDetachesAndReconnectRestoresWithoutStoppingOrResending() async throws {
        let desktop = Desktop()
        let running = try fixture(revision: 1, phase: "running", text: "Partial")
        desktop.sessions = [running]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        let stale = try #require(desktop.continuations.first)
        await store.suspend()
        #expect(desktop.stops.isEmpty)
        #expect(!store.isConnected)
        desktop.sessions = [try fixture(revision: 3, text: "Finished while the phone was locked")]
        await store.reconnect(); await drain()
        stale.yield(.session(try fixture(revision: 100, text: "Stale connection")))
        await drain()
        #expect(store.session(running.id)?.messages.last?.text == "Finished while the phone was locked")
        #expect(desktop.sent.isEmpty)
        await store.suspend()
    }

    @Test func approvalsAndQuestionsWaitForDesktopStateRatherThanMockCompletion() async throws {
        let desktop = Desktop()
        let pending = try fixture(phase: "approval")
        desktop.sessions = [pending]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        let approval = try #require(store.session(pending.id)?.phase.approval)
        store.respond(to: approval.id, in: pending.id, allow: true)
        await drain()
        #expect(desktop.approvals.count == 1)
        #expect(store.session(pending.id)?.phase.approval?.id == approval.id)
        #expect(store.session(pending.id)?.messages.count == 2)
        desktop.emit(.session(try fixture(revision: 3, phase: "question")))
        await drain()
        let question = try #require(store.session(pending.id)?.phase.question)
        store.answer(question.id, in: pending.id, answers: ["Core"])
        await drain()
        #expect(desktop.answers.first?.2 == ["Core"])
        #expect(store.session(pending.id)?.phase.question != nil)
        desktop.emit(.session(try fixture(revision: 4)))
        await drain()
        #expect(store.session(pending.id)?.phase == .completed)
        await store.suspend()
    }

    @Test func oldRevisionsCannotOverwriteNewerText() async throws {
        let desktop = Desktop()
        let value = try fixture()
        desktop.sessions = [value]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        desktop.emit(.session(try fixture(revision: 8, text: "Latest")))
        desktop.emit(.session(try fixture(revision: 3, text: "Old")))
        await drain()
        #expect(store.session(value.id)?.messages.last?.text == "Latest")
        await store.suspend()
    }

    @Test func uncertainDeliveryRequiresReconnectAndNeverAutomaticallyRetries() async throws {
        let desktop = Desktop()
        desktop.sendError = RemoteFailure("Connection interrupted")
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        let id = try #require(store.createSession(configuration: store.defaultConfiguration))
        await store.send("Inspect the workspace", to: id)?.value
        #expect(!store.isConnected)
        #expect(store.session(id)?.messages.isEmpty == true)
        desktop.sessions = [try fixture(id: id)]
        await store.reconnect(); await drain()
        #expect(desktop.sent.count == 1)
        #expect(store.session(id)?.phase == .completed)
        await store.suspend()
    }

    @Test func reconnectRestoresSameRevisionAfterUncertainFollowup() async throws {
        let desktop = Desktop()
        let value = try fixture()
        desktop.sessions = [value]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        desktop.sendError = RemoteFailure("Disconnected before acceptance")
        await store.send("Follow up", to: value.id)?.value
        #expect(!store.isConnected)
        #expect(store.session(value.id)?.phase != .completed)
        await store.reconnect(); await drain()
        #expect(store.session(value.id)?.phase == .completed)
        #expect(desktop.sent.count == 1)
        await store.suspend()
    }

    @Test func closeCannotForgetAnUnacknowledgedSend() async throws {
        let desktop = Desktop()
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        let id = try #require(store.createSession(configuration: store.defaultConfiguration))
        await store.send("Inspect the workspace", to: id)?.value
        store.delete(id)
        #expect(store.session(id) != nil)
        #expect(store.connectionError?.contains("acknowledge") == true)
        desktop.emit(.session(try fixture(id: id)))
        await drain()
        store.delete(id)
        await drain()
        #expect(desktop.removed == [id])
        await store.suspend()
    }

    @Test func connectionFailureDoesNotFallBackToDemo() async {
        let desktop = Desktop()
        desktop.bootstrapError = RemoteFailure("Computer is asleep")
        let store = SessionStore(desktop: desktop)
        await store.load()
        #expect(store.loadState == .ready)
        #expect(store.sessions.isEmpty)
        #expect(!store.isConnected)
    }

    @Test func unknownEventsFailVisiblyAndRealDiffCountsSurviveDecoding() throws {
        let value = try fixture()
        let local = value.localSession()
        #expect(local.additions == 1 && local.deletions == 1)
        #expect(local.diffNote?.contains("existing edits") == true)
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(RemoteEvent.self, from: Data("{\"type\":\"unknown\"}".utf8))
        }
    }

    @Test func pairingCodeRejectsPublicUrlsUserInfoAndMalformedIpv4() throws {
        func code(_ address: String) throws -> String {
            let data = try JSONSerialization.data(withJSONObject: [
                "version": 1, "address": address, "fingerprint": String(repeating: "a", count: 64), "ticket": String(repeating: "b", count: 64),
            ])
            return "DX1." + data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }
        #expect(try PairingCode.parse(code("https://192.168.1.2:44111")).address.host == "192.168.1.2")
        for value in ["http://192.168.1.2:44111", "https://example.com:443", "https://8.8.8.8:443", "https://user@192.168.1.2:443", "https://10.0.bad.0.1:443", "https://192.168.1.2:443/path"] {
            #expect(throws: (any Error).self) { try PairingCode.parse(code(value)) }
        }
    }
}


@Suite @MainActor
struct RemoteRefinementTests {
    @Test func catalogDoesNotInventEffortAndChoosesReportedDefault() async throws {
        let desktop = Desktop()
        desktop.models = [
            ["id": "no-effort", "name": "Plain model", "efforts": []],
            ["id": "reasoner", "name": "Reasoner", "efforts": ["medium", "xhigh"], "defaultEffort": "xhigh", "isDefault": true],
        ]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        #expect(store.defaultConfiguration.remoteModelID == "reasoner")
        #expect(store.defaultConfiguration.remoteEffort == "xhigh")
        var plain = store.defaultConfiguration
        plain.remoteModelID = "no-effort"
        plain.remoteEffort = nil
        #expect(store.models.first { $0.id == "no-effort" }?.efforts.isEmpty == true)
        let id = try #require(store.createSession(configuration: plain))
        await store.send("Inspect only", to: id)?.value
        #expect(desktop.sent.last?.effort == nil)
        await store.suspend()
    }

    @Test func idleDesktopConfigurationUpdatesUnlessUserHasAnUnsentChoice() async throws {
        let desktop = Desktop()
        let original = try fixture()
        desktop.sessions = [original]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as! [String: Any]
        object["effort"] = "low"
        object["revision"] = 3
        let updated = try JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: object))
        desktop.emit(.session(updated)); await drain()
        #expect(store.session(original.id)?.configuration.remoteEffort == "low")
        var draft = try #require(store.session(original.id)?.configuration)
        draft.remoteEffort = "high"
        store.configure(original.id, with: draft)
        object["revision"] = 4
        desktop.emit(.session(try JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: object))))
        await drain()
        #expect(store.session(original.id)?.configuration.remoteEffort == "high")
        await store.suspend()
    }

    @Test func waitingStateBlocksSendingAndSyncProgressRemainsTruthful() async throws {
        let desktop = Desktop()
        let waiting = try fixture(phase: "waiting")
        desktop.sessions = [waiting]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        #expect(store.session(waiting.id)?.phase == .waiting)
        #expect(store.send("Should not send", to: waiting.id) == nil)
        desktop.emit(.sync(.init(state: "error", message: "Recent sessions could not load")))
        await drain()
        #expect(store.sync.state == "error")
        await store.refreshRemote()
        #expect(desktop.refreshes == 1)
        #expect(desktop.sent.isEmpty)
        await store.suspend()
    }

    @Test func recentHistoryLoadsOnlyOnRequest() async throws {
        let desktop = Desktop()
        var recent = try fixture()
        recent.historyState = "unloaded"
        desktop.sessions = [recent]
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        #expect(desktop.historyRequests.isEmpty)
        store.loadRemoteHistory(recent.id)
        await drain()
        #expect(desktop.historyRequests == [recent.id])
        #expect(store.session(recent.id)?.historyState == "unloaded")
        await store.suspend()
    }
}

@Suite @MainActor
struct CompositionTests {
    @Test func rejectedCreationLeavesNoEmptySession() async throws {
        let desktop = Desktop()
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        #expect(throws: RemoteFailure.self) { try store.startSession(prompt: "  ", configuration: store.defaultConfiguration) }
        var missing = store.defaultConfiguration
        missing.remoteModelID = "missing"
        #expect(throws: RemoteFailure.self) { try store.startSession(prompt: "Inspect", configuration: missing) }
        #expect(store.sessions.isEmpty && desktop.sent.isEmpty)
        await store.suspend()
    }

    @Test func explicitRejectionKeepsDraftAndDoesNotMisreportDisconnection() async throws {
        let desktop = Desktop()
        desktop.sendError = RemoteFailure("Model no longer available", statusCode: 400)
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        let id = try store.startSession(prompt: "Inspect the project", configuration: store.defaultConfiguration)
        await drain()
        #expect(store.isConnected)
        #expect(store.pendingDeliveries[id] == nil)
        #expect(store.session(id)?.draft == "Inspect the project")
        #expect(store.actionErrors[id] == "Model no longer available")
        await store.suspend()
    }

    @Test func authoritativeReceiptWinsOverLostHttpResponse() async throws {
        let desktop = Desktop()
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        desktop.sendError = RemoteFailure("HTTP connection closed")
        desktop.beforeSendReturns = { turn in
            desktop.emit(.session(try fixture(id: turn.id, revision: 3, phase: "running", text: "Real output", requestID: turn.requestId)))
            await drain()
        }
        let id = try store.startSession(prompt: "  Inspect  ", configuration: store.defaultConfiguration)
        await drain()
        #expect(store.isConnected)
        #expect(store.pendingDeliveries[id] == nil)
        #expect(store.session(id)?.draft == "")
        #expect(store.session(id)?.messages.last?.text == "Real output")
        #expect(desktop.sent.count == 1)
        await store.suspend()
    }

    @Test func pendingSendBlocksDoubleSubmissionAndPlanChoiceReachesDesktop() async throws {
        let desktop = Desktop()
        let store = SessionStore(desktop: desktop)
        await store.load(); await drain()
        var configuration = store.defaultConfiguration
        configuration.interactionMode = .spec
        let id = try store.startSession(prompt: "Plan a change", configuration: configuration)
        #expect(store.send("Duplicate", to: id) == nil)
        await drain()
        #expect(desktop.sent.count == 1)
        #expect(desktop.sent[0].mode == .spec)
        #expect(store.pendingDeliveries[id]?.state == .accepted)
        #expect(store.session(id)?.phase == .waiting)
        await store.suspend()
    }
}
