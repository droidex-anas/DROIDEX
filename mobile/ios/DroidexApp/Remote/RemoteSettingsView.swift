import DroidexCore
import SwiftUI

struct RemoteSettingsView: View {
    @Environment(SessionStore.self) private var store
    @Environment(AppConnection.self) private var connection
    @State private var pairing = false
    @State private var showGuide = false
    @State private var confirmForget = false

    private var artworkPhase: PairingArtworkPhase {
        guard store.isRemote else { return .intro }
        guard store.isConnected else { return .offline }
        if store.sync.state == "loading" { return .syncing }
        return store.sessions.contains { $0.phase.isRunning } ? .running : .connected
    }

    var body: some View {
        Form {
            Section {
                PairingArtwork(phase: artworkPhase)
                    .frame(height: 210).allowsHitTesting(false)
                Text(store.isRemote ? store.computerName : "Connect your computer")
                    .font(.title2.weight(.semibold)).padding(.vertical, 6)
                Text(store.isRemote ? "Your projects and agent sessions, connected over your private network." : "Scan the QR in desktop Settings → Remote, or paste its pairing code.")
                    .foregroundStyle(DroidTheme.secondary)
                if store.isRemote {
                    LabeledContent("Connection", value: store.isConnected ? "Connected" : "Disconnected")
                    LabeledContent("Shared project", value: store.workspaceName)
                    LabeledContent("Recent sessions", value: "\(store.sessions.count)")
                    LabeledContent("Available models", value: "\(store.models.count)")
                    Button("Refresh connection") { Task { await store.reconnect() } }
                }
                Button { pairing = true } label: {
                    Text(store.isRemote ? "Pair again" : "Add computer")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("remote.add-computer")
            } footer: {
                Text("Only the project you share on the computer is available here. Keep the computer awake. A phone screen lock does not stop its agents.")
            }
            Section {
                Button("View and share SVG pairing guide") { showGuide = true }
                    .accessibilityIdentifier("remote.open-guide")
            }
            if let error = store.connectionError ?? connection.error {
                Section { Text(error).foregroundStyle(DroidTheme.danger) }
            }
            if store.isRemote {
                Section {
                    Button("Forget this computer", role: .destructive) { confirmForget = true }
                } footer: {
                    Text("Forgetting removes this phone’s credential. Disable Remote on the computer to revoke access. Existing desktop sessions are not closed by revoking phone access.")
                }
            }
        }
        .scrollContentBackground(.hidden).background(DroidTheme.background)
        .navigationTitle("Remote").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $pairing) {
            OnboardingView(startAtPairing: true, allowsPreview: false)
                .environment(connection)
        }
        .sheet(isPresented: $showGuide) { PairingGuideView() }
        .confirmationDialog("Forget this computer?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Forget computer", role: .destructive) { Task { await connection.forget() } }
        }
    }
}
