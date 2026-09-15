import DroidexCore
import SwiftUI

struct ComposerView: View {
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    @Binding var text: String
    @Binding var configuration: SessionConfiguration
    let phase: SessionPhase
    let send: () -> Void
    let stop: () -> Void

    @State private var showsReasoning = false

    private var canSubmit: Bool {
        phase.canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && text.trimmingCharacters(in: .whitespacesAndNewlines).count <= SessionStore.promptLimit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Follow up…", text: $text, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...5)
                    .frame(minHeight: 44)
                    .textInputAutocapitalization(.sentences)
                    .disabled(phase.approval != nil)
                    .accessibilityLabel("Message")
                    .accessibilityIdentifier("composer.input")

                HStack(spacing: 2) {
                    Menu {
                        ForEach(Harness.allCases, id: \.self) { harness in
                            Button {
                                configuration.harness = harness
                                let options = ModelChoice.options(for: harness)
                                if !options.contains(configuration.model) { configuration.model = options[0] }
                            } label: {
                                if configuration.harness == harness { Label(harness.rawValue, systemImage: "checkmark") }
                                else { Text(harness.rawValue) }
                            }
                        }
                    } label: { TextConfigLabel(configuration.harness.rawValue) }

                    Menu {
                        ForEach(ModelChoice.options(for: configuration.harness), id: \.self) { model in
                            Button { configuration.model = model } label: {
                                if configuration.model == model { Label(model.rawValue, systemImage: "checkmark") }
                                else { Text(model.rawValue) }
                            }
                        }
                    } label: { TextConfigLabel(configuration.model.rawValue) }

                    Button { showsReasoning = true } label: {
                        TextConfigLabel(configuration.reasoning.title)
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $showsReasoning, arrowEdge: .bottom) {
                        ReasoningPicker(configuration: $configuration)
                            .presentationCompactAdaptation(.popover)
                    }

                    Spacer(minLength: 2)

                    Button {
                        if phase.isRunning { stop() } else { send() }
                    } label: {
                        Image(systemName: phase.isRunning ? "stop.fill" : "arrow.up")
                            .font(.body.weight(.semibold))
                            .frame(width: 42, height: 42)
                            .foregroundStyle(DroidTheme.background)
                            .background(canSubmit || phase.isRunning ? DroidTheme.text : DroidTheme.secondary, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!phase.isRunning && !canSubmit)
                    .accessibilityLabel(phase.isRunning ? "Stop response" : "Send message")
                    .accessibilityIdentifier(phase.isRunning ? "composer.stop" : "composer.send")
                }

                HStack(spacing: 8) {
                    Picker("Mode", selection: $configuration.interactionMode) {
                        ForEach(InteractionMode.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 180)
                    Spacer()
                    Text("Preview").font(.caption2.weight(.medium)).foregroundStyle(DroidTheme.secondary)
                }
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 10)
            .modifier(GlassChrome())

            if text.count > SessionStore.promptLimit {
                Text("Keep your message under \(SessionStore.promptLimit.formatted()) characters.")
                    .font(.footnote).foregroundStyle(DroidTheme.danger).padding(.horizontal, 8)
            } else if phase.approval != nil {
                Text("Review the pending action before sending another message.")
                    .font(.footnote).foregroundStyle(DroidTheme.secondary).padding(.horizontal, 8)
            }
        }
        .sensoryFeedback(.selection, trigger: configuration) { _, _ in hapticsEnabled }
    }
}

struct TextConfigLabel: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        HStack(spacing: 4) {
            Text(title).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(DroidTheme.text)
        .padding(.horizontal, 7)
        .frame(height: 36)
        .contentShape(Rectangle())
    }
}

struct ReasoningPicker: View {
    @Binding var configuration: SessionConfiguration

    private let levels = ReasoningEffort.allCases

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reasoning effort")
                .font(.headline)

            HStack(spacing: 0) {
                ForEach(Array(levels.enumerated()), id: \.element) { index, level in
                    Button {
                        configuration.reasoning = level
                    } label: {
                        VStack(spacing: 9) {
                            ZStack {
                                if index < levels.count - 1 {
                                    Rectangle()
                                        .fill(index < configuration.reasoning.rawValue ? DroidTheme.text : DroidTheme.border)
                                        .frame(height: 2)
                                        .offset(x: 28)
                                }
                                Circle()
                                    .fill(level.rawValue <= configuration.reasoning.rawValue ? DroidTheme.text : DroidTheme.surface)
                                    .overlay(Circle().stroke(DroidTheme.text.opacity(level == configuration.reasoning ? 1 : 0.35), lineWidth: level == configuration.reasoning ? 2 : 1))
                                    .frame(width: level == configuration.reasoning ? 16 : 10, height: level == configuration.reasoning ? 16 : 10)
                            }
                            .frame(height: 18)

                            Text(level.title)
                                .font(.caption2.weight(level == configuration.reasoning ? .semibold : .regular))
                                .foregroundStyle(level == configuration.reasoning ? DroidTheme.text : DroidTheme.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(level.title)
                    .accessibilityAddTraits(level == configuration.reasoning ? .isSelected : [])
                }
            }

            Text("Choose how much reasoning the model uses before responding.")
                .font(.caption)
                .foregroundStyle(DroidTheme.secondary)
        }
        .padding(20)
        .frame(width: 320)
        .presentationBackground(.regularMaterial)
    }
}
