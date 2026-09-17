import Foundation
import Testing
@testable import DroidexCore

@Suite @MainActor
struct SessionArchiveTests {
    private func location() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "DROIDEX-tests/\(UUID().uuidString)/cache.json")
    }

    @Test func realChatsDiffsDraftsAndPendingReceiptsSurviveOfflineRelaunch() async throws {
        let url = location()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let desktop = Desktop()
        let original = try fixture(phase: "running", text: "Actual received partial response")
        desktop.sessions = [original]
        desktop.review = ReviewSnapshot(changes: original.changes, note: "Received working tree")
        let store = SessionStore(desktop: desktop, archiveURL: url)
        await store.load(); await drain()
        store.setDraft("Keep writing while offline", for: original.id)
        _ = try await store.workspaceChanges()
        let pendingID = try #require(store.createSession(configuration: store.defaultConfiguration))
        await store.send("Delivery may be in flight", to: pendingID)?.value
        await store.suspend()

        let offline = Desktop()
        offline.bootstrapError = RemoteFailure("Computer is off")
        let reopened = SessionStore(desktop: offline, archiveURL: url)
        await reopened.load()
        #expect(reopened.loadState == .ready && !reopened.isConnected)
        #expect(reopened.session(original.id)?.messages == original.messages)
        #expect(reopened.session(original.id)?.phase.isRunning == true)
        #expect(reopened.session(original.id)?.draft == "Keep writing while offline")
        #expect(try await reopened.workspaceChanges() == desktop.review)
        #expect(reopened.pendingDeliveries[pendingID]?.state == .uncertain)
        #expect(reopened.send("Never automatically replay", to: pendingID) == nil)
        reopened.stop(original.id)
        #expect(offline.sent.isEmpty && offline.stops.isEmpty)
        await reopened.suspend()
    }

    @Test func unreadableCacheIsPreservedRatherThanSilentlyReset() async throws {
        let url = location()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let original = Data("not valid JSON".utf8)
        try original.write(to: url)
        let desktop = Desktop()
        desktop.bootstrapError = RemoteFailure("Offline")
        let store = SessionStore(desktop: desktop, archiveURL: url)
        await store.load()
        #expect(store.storageError != nil)
        #expect(store.loadState == .ready)
        await store.flush()
        #expect(try Data(contentsOf: url) == original)
    }

    @Test func emptyRecentSnapshotDoesNotEraseCachedConversations() async throws {
        let url = location()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let desktop = Desktop()
        let original = try fixture()
        desktop.sessions = [original]
        let store = SessionStore(desktop: desktop, archiveURL: url)
        await store.load(); await drain(); await store.suspend()
        let next = Desktop()
        let reopened = SessionStore(desktop: next, archiveURL: url)
        await reopened.load(); await drain()
        #expect(reopened.session(original.id)?.messages == original.messages)
        var summary = try JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as! [String: Any]
        summary["revision"] = 1
        summary["historyState"] = "unloaded"
        summary["messages"] = []
        summary["changes"] = []
        let unloaded = try JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: summary))
        next.emit(.snapshot([unloaded])); await drain()
        #expect(reopened.session(original.id)?.messages == original.messages)
        #expect(reopened.session(original.id)?.changes == original.changes)
        next.emit(.removed(original.id)); await drain()
        #expect(reopened.session(original.id) == nil)
        await reopened.suspend()
    }

    @Test func cacheCannotCrossComputerIdentity() async throws {
        let url = location()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let desktop = Desktop()
        desktop.sessions = [try fixture()]
        let store = SessionStore(desktop: desktop, archiveURL: url, computerID: computerID)
        await store.load(); await drain(); await store.suspend()
        let offline = Desktop()
        offline.bootstrapError = RemoteFailure("Offline")
        let wrong = SessionStore(desktop: offline, archiveURL: url, computerID: UUID())
        await wrong.load()
        #expect(wrong.sessions.isEmpty && wrong.storageError != nil)
    }

    @Test func repeatedForegroundEventsDoNotOpenTwoStreams() async throws {
        let desktop = Desktop()
        desktop.automaticSnapshot = false
        let store = SessionStore(desktop: desktop)
        await store.load()
        await drain()
        #expect(store.isConnecting)
        await store.load()
        await drain()
        #expect(desktop.bootstrapCount == 1 && desktop.continuations.count == 1)
        desktop.emit(.snapshot([])); await drain()
        #expect(store.isConnected && !store.isConnecting)
        await store.suspend()
    }
}
