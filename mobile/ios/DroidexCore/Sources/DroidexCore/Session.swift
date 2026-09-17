import Foundation

public enum InteractionMode: String, Codable, CaseIterable, Sendable {
    case auto, spec

    public var title: String { self == .auto ? "Build" : "Plan" }
}

public struct SessionConfiguration: Codable, Equatable, Sendable {
    public var interactionMode: InteractionMode
    public var remoteModelID: String?
    public var remoteEffort: String?

    public init(interactionMode: InteractionMode = .auto, remoteModelID: String? = nil, remoteEffort: String? = nil) {
        self.interactionMode = interactionMode
        self.remoteModelID = remoteModelID
        self.remoteEffort = remoteEffort
    }
}

public struct Approval: Codable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let title: String
    public let detail: String
    public var kind: String? = nil
    public var isPlan: Bool { kind == "spec" || kind == "mission_plan" }

    public init(id: UUID = UUID(), title: String, detail: String) {
        self.id = id
        self.title = title
        self.detail = detail
    }
}

public enum SessionPhase: Codable, Equatable, Sendable {
    case ready
    case waiting
    case running(UUID)
    case needsApproval(Approval)
    case needsAnswer(RemoteQuestion)
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

    public var question: RemoteQuestion? {
        if case .needsAnswer(let question) = self { return question }
        return nil
    }

    public var canSend: Bool { self != .waiting && !isRunning && approval == nil && question == nil }
}

public struct ChatMessage: Codable, Equatable, Sendable, Identifiable {
    public enum Role: String, Codable, Sendable { case user, assistant }

    public let id: UUID
    public let role: Role
    public var text: String
    public var steps: [String]
    public var activity: [AgentActivity]? = nil

    public init(id: UUID = UUID(), role: Role, text: String, steps: [String] = []) {
        self.id = id
        self.role = role
        self.text = text
        self.steps = steps
    }
}

public struct DiffLine: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case context, addition, deletion, hunk }
    public let kind: Kind
    public let text: String
    public var oldLine: Int? = nil
    public var newLine: Int? = nil

    public init(_ kind: Kind, _ text: String) {
        self.kind = kind
        self.text = text
    }

    public var prefix: String {
        switch kind {
        case .hunk: ""
        case .context: " "
        case .addition: "+"
        case .deletion: "−"
        }
    }
}

public struct FileChange: Codable, Equatable, Sendable, Identifiable {
    public let path: String
    public let lines: [DiffLine]
    public var status: String? = nil
    public var note: String? = nil
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
    public var diffNote: String?
    public var historyState: String? = nil
    public var historyNote: String? = nil
    public var id: UUID { appSessionId }
    public var additions: Int { changes.reduce(0) { $0 + $1.additions } }
    public var deletions: Int { changes.reduce(0) { $0 + $1.deletions } }

    public init(
        appSessionId: UUID = UUID(), title: String, workspace: String = "droid-maxxing",
        configuration: SessionConfiguration = .init(), phase: SessionPhase = .ready,
        messages: [ChatMessage] = [], changes: [FileChange] = [], draft: String = "",
        updatedAt: Date = .now, diffNote: String? = nil
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
        self.diffNote = diffNote
    }
}
