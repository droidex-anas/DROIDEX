import DroidexCore
import SwiftUI

struct NewSessionView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var prompt = ""
    @State private var configuration = SessionConfiguration()
    let onCreate: (UUID) -> Void

    private var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canStart: Bool { !trimmedPrompt.isEmpty && trimmedPrompt.count <= SessionStore.promptLimit }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("droid-maxxing", systemImage: "folder")
                        .foregroundStyle(DroidTheme.secondary)
                    TextField("Plan, ask, build…", text: $prompt, axis: .vertical)
                        .font(.body)
                        .lineLimit(4...10)
                        .focused($focused)
                        .accessibilityLabel("New session message")
                        .accessibilityIdentifier("new-session.prompt")
                } footer: {
                    if trimmedPrompt.count > SessionStore.promptLimit {
                        Text("Keep your message under \(SessionStore.promptLimit.formatted()) characters.")
                            .foregroundStyle(DroidTheme.danger)
                    }
                }
                Section("Preview configuration") {
                    Picker("Harness", selection: $configuration.harness) {
                        ForEach(Harness.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    Picker("Mode", selection: $configuration.interactionMode) {
                        ForEach(InteractionMode.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                }
                Section {
                    Label("Runs entirely on this device", systemImage: "iphone")
                        .font(.subheadline)
                } footer: {
                    Text("This MVP uses scripted responses and sample diffs so you can try the interface without an account. Harness choices are previews, not live connections. Build demonstrates approvals; Plan stops at a reviewable proposal.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(DroidTheme.background)
            .navigationTitle("New session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") {
                        guard canStart, let id = store.createSession(configuration: configuration) else { return }
                        store.send(trimmedPrompt, to: id)
                        onCreate(id)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(!canStart)
                    .accessibilityIdentifier("new-session.start")
                }
            }
            .task { focused = true }
        }
        .interactiveDismissDisabled(!prompt.isEmpty)
    }
}
