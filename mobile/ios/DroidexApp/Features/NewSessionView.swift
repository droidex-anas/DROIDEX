import DroidexCore
import SwiftUI

struct NewSessionView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var prompt = ""
    @State private var configuration = SessionConfiguration()
    @State private var initialized = false
    @State private var submitted = false
    @State private var error: String?
    let onCreate: (UUID) -> Void

    private var issue: String? { store.submissionError(prompt, configuration: configuration) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(store.workspaceName).font(.subheadline.weight(.medium)).foregroundStyle(DroidTheme.secondary)
                        Text(configuration.interactionMode == .spec ? "Think it through." : "What are we building?")
                            .font(.title2.weight(.semibold)).tracking(-0.6)
                        Text(configuration.interactionMode == .spec ? "Start with a plan. Review it before approving the next step." : "Give your computer a task. Follow the work here.")
                            .font(.subheadline).foregroundStyle(DroidTheme.secondary)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        TextField("Describe a task…", text: $prompt, axis: .vertical)
                            .lineLimit(4...10).focused($focused).font(.body)
                            .textInputAutocapitalization(.sentences)
                            .accessibilityLabel("New session message").accessibilityIdentifier("new-session.prompt")
                        Divider().overlay(DroidTheme.separator)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 16) { modelControls }.fixedSize()
                            VStack(alignment: .leading, spacing: 4) { modelControls }
                        }
                        HStack {
                            HarnessControl(configuration: $configuration)
                            Spacer()
                            Picker("Mode", selection: $configuration.interactionMode) {
                                ForEach(InteractionMode.allCases, id: \.self) { Text($0.title).tag($0) }
                            }
                            .pickerStyle(.segmented).frame(maxWidth: 170)
                        }
                    }
                    .padding(18).background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 20))
                    if let message = error ?? (prompt.isEmpty ? nil : issue) {
                        Text(message).font(.footnote).foregroundStyle(DroidTheme.danger).accessibilityIdentifier("new-session.error")
                    }
                    if store.isRemote {
                        Text(store.isConnected ? "Runs on \(store.computerName). Your provider account and approvals stay on the computer." : "Computer disconnected. Reconnect before starting a session.")
                            .font(.footnote).foregroundStyle(DroidTheme.secondary)
                        if store.models.isEmpty || !store.isConnected {
                            Button("Reconnect and refresh models") { Task { await store.reconnect() } }
                                .frame(minHeight: 44)
                        }
                    } else {
                        Text("Offline preview · Responses and changes are illustrative.").font(.footnote).foregroundStyle(DroidTheme.secondary)
                    }
                }
                .frame(maxWidth: 640).padding(24).frame(maxWidth: .infinity)
            }
            .background(DroidTheme.background).scrollDismissesKeyboard(.interactively)
            .navigationTitle("New session").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Button(action: start) {
                    Text(submitted ? "Opening session…" : configuration.interactionMode == .spec ? "Start planning" : "Start session")
                        .font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 52)
                        .foregroundStyle(DroidTheme.background).background(DroidTheme.text, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain).disabled(issue != nil || submitted).opacity(issue == nil ? 1 : 0.45)
                .accessibilityIdentifier("new-session.start").padding(.horizontal, 24).padding(.vertical, 12)
                .background(DroidTheme.background)
            }
            .onAppear {
                guard !initialized else { return }
                initialized = true
                configuration = store.defaultConfiguration
                focused = true
            }
            .onChange(of: store.models) { _, models in
                guard store.isRemote, !models.contains(where: { $0.id == configuration.remoteModelID }) else { return }
                let mode = configuration.interactionMode
                configuration = store.defaultConfiguration
                configuration.interactionMode = mode
            }
        }
        .interactiveDismissDisabled(!prompt.isEmpty && !submitted)
    }

    @ViewBuilder private var modelControls: some View {
        ModelControl(configuration: $configuration)
        EffortControl(configuration: $configuration)
    }

    private func start() {
        guard !submitted else { return }
        do {
            let id = try store.startSession(prompt: prompt, configuration: configuration)
            submitted = true
            focused = false
            onCreate(id)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
