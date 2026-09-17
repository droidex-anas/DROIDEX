import Foundation

/// A bounded, local copy of received content. Credentials never enter this file.
actor RemoteArchive {
    struct Snapshot: Codable, Sendable {
        var version = 1
        let computerID: UUID?
        let computerName: String
        let workspace: String
        let sessions: [AgentSession]
        let models: [RemoteModel]
        let lastSyncedAt: Date?
        let knownRemoteIDs: Set<UUID>
        let configurationDrafts: Set<UUID>
        let deliveries: [UUID: PendingDelivery]
        let changes: ReviewSnapshot?
        let changesSyncedAt: Date?
        let pullRequests: [RemotePullRequest]?
        let pullRequestReviews: [Int: PullRequestReview]
    }

    private let url: URL
    private let computerID: UUID?
    private let byteLimit = 16 * 1024 * 1024
    private var latestRevision = 0
    private var loadFailed = false

    init(url: URL, computerID: UUID?) {
        self.url = url
        self.computerID = computerID
    }

    func load() throws -> Snapshot? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= byteLimit else { throw RemoteFailure("The saved cache exceeds its size limit.") }
            let saved = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url))
            guard saved.version == 1, saved.computerID == computerID,
                  Set(saved.sessions.map(\.id)).count == saved.sessions.count,
                  saved.deliveries.allSatisfy({ $0.key == $0.value.request.id }) else {
                throw RemoteFailure("The saved cache has an invalid identity or format.")
            }
            return saved
        } catch {
            loadFailed = true
            throw error
        }
    }

    func save(_ snapshot: Snapshot, revision: Int) throws {
        guard !loadFailed else { throw RemoteFailure("The unreadable cache is preserved. Forget and pair again to replace it.") }
        guard revision >= latestRevision else { return }
        let data = try JSONEncoder().encode(snapshot)
        guard data.count <= byteLimit else { throw RemoteFailure("The offline cache is full. Existing saved content is preserved.") }
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS)
        options.insert(.completeFileProtectionUntilFirstUserAuthentication)
        #endif
        try data.write(to: url, options: options)
        #if os(iOS)
        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try target.setResourceValues(values)
        #endif
        latestRevision = revision
    }
}
