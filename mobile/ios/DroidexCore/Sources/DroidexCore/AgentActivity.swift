import Foundation

public struct AgentActivity: Codable, Equatable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable { case thinking, tool, status }
    public enum Status: String, Codable, Sendable { case running, completed, failed, interrupted }
    public let id: String
    public let kind: Kind
    public let title: String
    public let detail: String?
    public let status: Status
    public let startedAt: Double?
    public let endedAt: Double?
}

public struct ReviewSnapshot: Codable, Equatable, Sendable {
    public let changes: [FileChange]
    public let note: String
    public init(changes: [FileChange], note: String) { self.changes = changes; self.note = note }
}

public struct RemotePullRequest: Decodable, Equatable, Identifiable, Sendable {
    public let number: Int
    public let title: String
    public let state: String
    public let url: URL
    public let headRefName: String
    public let baseRefName: String
    public let isDraft: Bool
    public let updatedAt: String?
    public var id: Int { number }
}

public struct PullRequestReview: Decodable, Sendable {
    public let pullRequest: RemotePullRequest
    public let body: String
    public let review: ReviewSnapshot
}
