import Foundation

public enum Harness: String, Codable, CaseIterable, Sendable {
    case droid = "Droid"
    case claude = "Claude Code"
    case codex = "Codex"
}

public enum InteractionMode: String, Codable, CaseIterable, Sendable {
    case auto, spec

    public var title: String { self == .auto ? "Build" : "Plan" }
}

public struct SessionConfiguration: Codable, Equatable, Sendable {
    public var harness: Harness
    public var interactionMode: InteractionMode

    public init(harness: Harness = .droid, interactionMode: InteractionMode = .auto) {
        self.harness = harness
        self.interactionMode = interactionMode
    }
}

public struct Approval: Codable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let detail: String

    public init(id: UUID = UUID(), title: String, detail: String) {
        self.id = id
        self.title = title
        self.detail = detail
    }
}

public enum SessionPhase: Codable, Equatable, Sendable {
    case ready
    case running(UUID)
    case needsApproval(Approval)
    case completed
    case stopped
    case failed(String)

    public var isRunning: Bool {
        if case .running = self { return true }
        return false
    }

    public var approval: Approval? {
        if case .needsApproval(let approval) = self { return approval }
        return nil
    }

    public var canSend: Bool { !isRunning && approval == nil }
}

public struct ChatMessage: Codable, Equatable, Sendable, Identifiable {
    public enum Role: String, Codable, Sendable { case user, assistant }

    public let id: UUID
    public let role: Role
    public var text: String
    public var steps: [String]

    public init(id: UUID = UUID(), role: Role, text: String, steps: [String] = []) {
        self.id = id
        self.role = role
        self.text = text
        self.steps = steps
    }
}

public struct DiffLine: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case context, addition, deletion }
    public let kind: Kind
    public let text: String

    public init(_ kind: Kind, _ text: String) {
        self.kind = kind
        self.text = text
    }

    public var prefix: String {
        switch kind {
        case .context: " "
        case .addition: "+"
        case .deletion: "−"
        }
    }
}

public struct FileChange: Codable, Equatable, Sendable, Identifiable {
    public let path: String
    public let lines: [DiffLine]
    public var id: String { path }
    public var additions: Int { lines.filter { $0.kind == .addition }.count }
    public var deletions: Int { lines.filter { $0.kind == .deletion }.count }

    public init(path: String, lines: [DiffLine]) {
        self.path = path
        self.lines = lines
    }
}

public struct AgentSession: Codable, Equatable, Sendable, Identifiable {
    public let appSessionId: UUID
    public var title: String
    public let workspace: String
    public var configuration: SessionConfiguration
    public var phase: SessionPhase
    public var messages: [ChatMessage]
    public var changes: [FileChange]
    public var draft: String
    public var updatedAt: Date
    public var id: UUID { appSessionId }
    public var additions: Int { changes.reduce(0) { $0 + $1.additions } }
    public var deletions: Int { changes.reduce(0) { $0 + $1.deletions } }

    public init(
        appSessionId: UUID = UUID(), title: String, workspace: String = "droid-maxxing",
        configuration: SessionConfiguration = .init(), phase: SessionPhase = .ready,
        messages: [ChatMessage] = [], changes: [FileChange] = [], draft: String = "",
        updatedAt: Date = .now
    ) {
        self.appSessionId = appSessionId
        self.title = title
        self.workspace = workspace
        self.configuration = configuration
        self.phase = phase
        self.messages = messages
        self.changes = changes
        self.draft = draft
        self.updatedAt = updatedAt
    }
}

public struct TurnRequest: Sendable {
    public let appSessionId: UUID
    public let text: String
    public let configuration: SessionConfiguration
}

public enum AgentEvent: Sendable {
    case step(String)
    case text(String)
    case changes([FileChange])
    case approval(Approval)
    case completed
}

@MainActor
public protocol AgentClient {
    func events(for request: TurnRequest) -> AsyncThrowingStream<AgentEvent, Error>
}
