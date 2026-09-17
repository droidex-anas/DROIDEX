import Foundation

public struct PendingDelivery: Codable, Equatable, Sendable {
    public enum State: String, Codable, Sendable { case sending, accepted, uncertain }
    public let request: RemoteTurn
    public var state: State
    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.request.requestId == rhs.request.requestId && lhs.state == rhs.state
    }
}

extension SessionStore {
    public var defaultConfiguration: SessionConfiguration {
        var result = SessionConfiguration()
        if let model = models.first(where: { $0.isDefault == true }) ?? models.first {
            result.remoteModelID = model.id
            result.remoteEffort = model.defaultEffort.flatMap { model.efforts.contains($0) ? $0 : nil } ?? model.efforts.first
        }
        return result
    }

    public func modelName(_ configuration: SessionConfiguration) -> String {
        return models.first { $0.id == configuration.remoteModelID }?.name ?? configuration.remoteModelID.flatMap { $0.isEmpty ? nil : $0 } ?? "Choose model"
    }

    public func effortName(_ configuration: SessionConfiguration) -> String {
        guard let model = models.first(where: { $0.id == configuration.remoteModelID }) else { return "Choose model" }
        guard !model.efforts.isEmpty else { return "No effort control" }
        guard let effort = configuration.remoteEffort, model.efforts.contains(effort) else { return "Choose effort" }
        return Self.effortTitle(effort)
    }

    public static func effortTitle(_ value: String) -> String {
        value == "xhigh" ? "Extra high" : value.capitalized
    }


    public func submissionError(_ prompt: String, configuration: SessionConfiguration) -> String? {
        guard canSend else { return "Reconnect to your computer to send a message." }
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return "Write a message to start." }
        guard text.count <= Self.promptLimit else { return "Keep your message under \(Self.promptLimit.formatted()) characters." }
        guard let model = models.first(where: { $0.id == configuration.remoteModelID }) else {
            return "Choose an available model from your computer."
        }
        if !model.efforts.isEmpty && !model.efforts.contains(configuration.remoteEffort ?? "") {
            return "Choose a reasoning level supported by this model."
        }
        return nil
    }

    /// Creation and local send admission happen without suspension or a half-created sheet.
    @discardableResult
    public func startSession(prompt: String, configuration: SessionConfiguration) throws -> UUID {
        if let error = submissionError(prompt, configuration: configuration) { throw RemoteFailure(error) }
        guard let id = createSession(configuration: configuration) else { throw RemoteFailure("The session could not be created. Try again.") }
        setDraft(prompt, for: id)
        guard send(prompt, to: id) != nil else {
            delete(id)
            throw RemoteFailure("The message could not be submitted. Your draft is still here.")
        }
        return id
    }

    public func remoteFiles(path: String, cursor: String? = nil) async throws -> RemoteFilePage {
        guard isConnected else { throw RemoteFailure("Reconnect to browse this project.") }
        return try await desktop.files(path: path, cursor: cursor)
    }

    public func remoteFile(path: String) async throws -> RemoteFileContent {
        guard isConnected else { throw RemoteFailure("Reconnect to open this file.") }
        return try await desktop.file(path: path)
    }


    public func workspaceChanges() async throws -> ReviewSnapshot {
        guard isConnected else {
            if let cachedChanges { return cachedChanges }
            throw RemoteFailure("No changes have been downloaded yet. Connect the computer to load them.")
        }
        let generation = remoteGeneration
        let result = try await desktop.changes()
        guard generation == remoteGeneration, !Task.isCancelled else { throw CancellationError() }
        cachedChanges = result
        changesSyncedAt = .now
        scheduleSave()
        return result
    }

    public func pullRequests() async throws -> [RemotePullRequest] {
        guard isConnected else {
            if let cachedPullRequests { return cachedPullRequests }
            throw RemoteFailure("No pull requests have been downloaded yet. Connect the computer to load them.")
        }
        let generation = remoteGeneration
        let result = try await desktop.pullRequests()
        guard generation == remoteGeneration, !Task.isCancelled else { throw CancellationError() }
        cachedPullRequests = result
        scheduleSave()
        return result
    }

    public func pullRequest(_ number: Int) async throws -> PullRequestReview {
        guard isConnected else {
            if let saved = cachedPullRequestReviews[number] { return saved }
            throw RemoteFailure("This pull request has not been downloaded. Connect the computer to open it.")
        }
        let generation = remoteGeneration
        let result = try await desktop.pullRequest(number)
        guard generation == remoteGeneration, !Task.isCancelled else { throw CancellationError() }
        cachedPullRequestReviews[number] = result
        scheduleSave()
        return result
    }
}
