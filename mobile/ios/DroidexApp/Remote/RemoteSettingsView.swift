import DroidexCore
import SwiftUI

struct RemoteSettingsView: View {
    @Environment(SessionStore.self) private var store
    @Environment(AppConnection.self) private var connection
    @State private var pairing = false
    @State private var showGuide = false
    @State private var confirmForget = false

    var body: some View {
        Form {
            Section {
                Text(store.computerName)
                    .font(.title2.weight(.semibold)).padding(.vertical, 6)
                Text("Conversations already received stay available when your computer is offline.")
                    .foregroundStyle(DroidTheme.secondary)
                Group {
                    LabeledContent("Connection", value: store.isConnected ? "Connected" : "Disconnected")
                    LabeledContent("Shared project", value: store.workspaceName)
                    LabeledContent("Recent sessions", value: "\(store.sessions.count)")
                    LabeledContent("Available models", value: "\(store.models.count)")
                    Button("Refresh connection") { Task { await store.reconnect() } }
                }
                Button { pairing = true } label: {
                    Text("Pair again")
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
            Group {
                Section {
                    Button("Forget this computer", role: .destructive) { confirmForget = true }
                } footer: {
                    Text("Forgetting removes this phone’s credential and its saved conversations, drafts, and reviews. Disable Remote on the computer to revoke access. Existing desktop sessions are not closed by revoking phone access.")
                }
            }
        }
        .scrollContentBackground(.hidden).background(DroidTheme.background)
        .navigationTitle("Remote").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $pairing) {
            OnboardingView(startAtPairing: true)
                .environment(connection)
        }
        .sheet(isPresented: $showGuide) { PairingGuideView() }
        .confirmationDialog("Forget this computer?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Forget computer", role: .destructive) { Task { await connection.forget() } }
        }
    }
}
