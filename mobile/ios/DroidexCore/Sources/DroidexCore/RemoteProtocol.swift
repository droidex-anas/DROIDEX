import Foundation

public struct RemoteModel: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let efforts: [String]
    public let defaultEffort: String?
    public var isDefault: Bool? = nil
}

public struct RemoteQuestion: Codable, Equatable, Identifiable, Sendable {
    public struct Item: Codable, Equatable, Sendable {
        public let index: Int
        public let question: String
        public let options: [String]
    }
    public let id: UUID
    public let questions: [Item]
}

public struct RemoteSession: Codable, Equatable, Identifiable, Sendable {
    public enum Phase: String, Codable, Sendable {
        case ready, running, waiting, approval, question, completed, stopped, failed
    }
    public let id: UUID
    public let runId: UUID
    public let revision: Int
    public var lastRequestId: UUID? = nil
    public let title: String
    public let workspace: String
    public let modelId: String
    public let effort: String?
    public let mode: InteractionMode
    public let phase: Phase
    public let messages: [ChatMessage]
    public let changes: [FileChange]
    public let diffNote: String
    public var historyState: String? = nil
    public var historyNote: String? = nil
    public let approval: Approval?
    public let question: RemoteQuestion?
    public let error: String?
    public let updatedAt: Double

    public func localSession(draft: String = "") -> AgentSession {
        let state: SessionPhase
        switch phase {
        case .ready: state = .ready
        case .waiting: state = .waiting
        case .running: state = .running(runId)
        case .approval:
            state = approval.map(SessionPhase.needsApproval) ?? .failed("The desktop sent an incomplete approval. Reconnect before continuing.")
        case .question:
            state = question.map(SessionPhase.needsAnswer) ?? .failed("The desktop sent an incomplete question. Reconnect before continuing.")
        case .completed: state = .completed
        case .stopped: state = .stopped
        case .failed: state = .failed(error ?? "The desktop agent could not finish.")
        }
        var configuration = SessionConfiguration(interactionMode: mode)
        configuration.remoteModelID = modelId
        configuration.remoteEffort = effort
        var result = AgentSession(
            appSessionId: id, title: title, workspace: workspace, configuration: configuration,
            phase: state, messages: messages, changes: changes, draft: draft,
            updatedAt: Date(timeIntervalSince1970: updatedAt / 1_000), diffNote: diffNote
        )
        result.historyState = historyState
        result.historyNote = historyNote
        return result
    }
}

public struct RemoteBootstrap: Decodable, Sendable {
    public let version: Int
    public let computerId: UUID
    public let computerName: String
    public let workspace: String
    public let models: [RemoteModel]
    public let sessions: [RemoteSession]
    public let sync: RemoteSync?
}

public enum RemoteEvent: Decodable, Sendable {
    case snapshot([RemoteSession])
    case session(RemoteSession)
    case removed(UUID)
    case catalog([RemoteModel])
    case sync(RemoteSync)
    case heartbeat

    private enum Keys: String, CodingKey { case type, sessions, session, id, models, sync }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Keys.self)
        switch try values.decode(String.self, forKey: .type) {
        case "snapshot": self = .snapshot(try values.decode([RemoteSession].self, forKey: .sessions))
        case "session": self = .session(try values.decode(RemoteSession.self, forKey: .session))
        case "removed": self = .removed(try values.decode(UUID.self, forKey: .id))
        case "catalog": self = .catalog(try values.decode([RemoteModel].self, forKey: .models))
        case "sync": self = .sync(try values.decode(RemoteSync.self, forKey: .sync))
        case "heartbeat": self = .heartbeat
        default: throw DecodingError.dataCorruptedError(forKey: .type, in: values, debugDescription: "Unsupported desktop event. Update both apps.")
        }
    }
}

public struct RemoteTurn: Codable, Sendable {
    public let id: UUID
    public let requestId: UUID
    public let prompt: String
    public let modelId: String
    public let effort: String?
    public let mode: InteractionMode

    public init(id: UUID, requestId: UUID = UUID(), prompt: String, modelId: String, effort: String?, mode: InteractionMode) {
        self.id = id
        self.requestId = requestId
        self.prompt = prompt
        self.modelId = modelId
        self.effort = effort
        self.mode = mode
    }
}

@MainActor
public protocol DesktopService {
    func bootstrap() async throws -> RemoteBootstrap
    func updates() -> AsyncThrowingStream<RemoteEvent, Error>
    func send(_ turn: RemoteTurn) async throws
    func stop(_ id: UUID) async throws
    func approve(_ approvalID: UUID, in sessionID: UUID, allow: Bool) async throws
    func answer(_ questionID: UUID, in sessionID: UUID, answers: [String]) async throws
    func remove(_ id: UUID) async throws
    func refresh() async throws
    func loadHistory(_ id: UUID) async throws
    func files(path: String, cursor: String?) async throws -> RemoteFilePage
    func file(path: String) async throws -> RemoteFileContent
    func changes() async throws -> ReviewSnapshot
    func pullRequests() async throws -> [RemotePullRequest]
    func pullRequest(_ number: Int) async throws -> PullRequestReview
}

public struct RemoteFailure: LocalizedError, Sendable {
    public let message: String
    public let statusCode: Int?
    public init(_ message: String, statusCode: Int? = nil) { self.message = message; self.statusCode = statusCode }
    public var wasRejected: Bool { statusCode.map { (400..<500).contains($0) } ?? false }
    public var errorDescription: String? { message }
}

// The pairing code carries the sole trusted address and certificate pin. It is not a URL to open in a browser.
public struct PairingCode: Codable, Equatable, Sendable {
    public let version: Int
    public let address: URL
    public let fingerprint: String
    public let ticket: String

    public static func parse(_ input: String) throws -> PairingCode {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.hasPrefix("DX1."), value.count < 2_048 else {
            throw RemoteFailure("Paste the complete pairing code from DROIDEX on your computer.")
        }
        var encoded = String(value.dropFirst(4)).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded) else { throw RemoteFailure("That pairing code is not valid.") }
        let code = try JSONDecoder().decode(PairingCode.self, from: data)
        try code.validate()
        return code
    }

    public func validate() throws {
        let rawParts = address.host?.split(separator: ".") ?? []
        let parts = rawParts.compactMap { UInt8($0) }
        let isPrivate = rawParts.count == 4 && parts.count == 4 && parts.map(String.init).joined(separator: ".") == address.host && (
            parts[0] == 10 || (parts[0] == 192 && parts[1] == 168)
            || (parts[0] == 172 && (16...31).contains(parts[1]))
            || parts == [127, 0, 0, 1]
        )
        let hex = CharacterSet(charactersIn: "0123456789abcdef")
        guard version == 1, address.scheme == "https", isPrivate,
              address.user == nil, address.password == nil, address.query == nil, address.fragment == nil,
              address.path.isEmpty || address.path == "/", let port = address.port, (1...65_535).contains(port),
              fingerprint.count == 64, ticket.count == 64,
              fingerprint.unicodeScalars.allSatisfy(hex.contains), ticket.unicodeScalars.allSatisfy(hex.contains) else {
            throw RemoteFailure("This code is not a supported private-network DROIDEX connection.")
        }
    }
}

public struct RemoteSync: Codable, Equatable, Sendable {
    public let state: String
    public let message: String
    public init(state: String, message: String) { self.state = state; self.message = message }
}

public struct RemoteFileEntry: Decodable, Identifiable, Sendable {
    public let name: String
    public let path: String
    public let directory: Bool
    public var id: String { path }
}

public struct RemoteFilePage: Decodable, Sendable {
    public let path: String
    public let entries: [RemoteFileEntry]
    public let nextCursor: String?
}

public struct RemoteFileContent: Decodable, Sendable {
    public let path: String
    public let text: String
    public let truncated: Bool
}
