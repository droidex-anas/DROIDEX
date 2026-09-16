import DroidexCore
import Foundation
import Observation

@MainActor
@Observable
final class AppConnection {
    var store: SessionStore?
    var error: String?
    private var restored = false

    func restore() {
        guard !restored else { return }
        restored = true
        // UI tests exercise real unpaired navigation without changing saved credentials.
        guard !ProcessInfo.processInfo.arguments.contains("--pairing-ui-testing") else { return }
        do {
            if let credential = try CredentialVault.load() {
                store = try makeStore(credential)
            }
        } catch { self.error = error.localizedDescription }
    }

    func connect(_ credential: DesktopCredential) async throws {
        let next = try makeStore(credential)
        await store?.suspend()
        try CredentialVault.save(credential)
        store = next
        error = nil
    }

    func forget() async {
        do {
            let credential = try CredentialVault.load()
            await store?.suspend()
            if let credential {
                let url = cacheURL(credential.computerId)
                if FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.removeItem(at: url)
                }
            }
            try CredentialVault.delete()
            store = nil
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func makeStore(_ credential: DesktopCredential) throws -> SessionStore {
        SessionStore(desktop: try DesktopConnection(credential: credential),
                     archiveURL: cacheURL(credential.computerId), computerID: credential.computerId)
    }

    private func cacheURL(_ id: UUID) -> URL {
        URL.applicationSupportDirectory.appending(path: "DROIDEX/Remote/\(id.uuidString).json")
    }
}
