import DroidexCore
import SwiftUI

struct HarnessControl: View {
    var body: some View {
        Text("Droid").font(.caption.weight(.medium))
            .accessibilityLabel("Harness: Droid")
    }
}

struct ModelControl: View {
    @Environment(SessionStore.self) private var store
    @Binding var configuration: SessionConfiguration

    var body: some View {
        Menu {
            ForEach(store.models) { model in
                Button(model.name) {
                    configuration.remoteModelID = model.id
                    if !model.efforts.contains(configuration.remoteEffort ?? "") {
                        configuration.remoteEffort = model.defaultEffort.flatMap {
                            model.efforts.contains($0) ? $0 : nil
                        } ?? model.efforts.first
                    }
                }
            }
        } label: { TextConfigLabel(store.modelName(configuration)) }
        .disabled(store.models.isEmpty)
        .accessibilityLabel("Model")
        .accessibilityValue(store.modelName(configuration))
        .accessibilityIdentifier("configuration.model")
    }
}

struct EffortControl: View {
    @Environment(SessionStore.self) private var store
    @Binding var configuration: SessionConfiguration
    @State private var presented = false

    private var available: [String] {
        store.models.first { $0.id == configuration.remoteModelID }?.efforts ?? []
    }

    var body: some View {
        if !available.isEmpty {
        Button { presented = true } label: { TextConfigLabel(store.effortName(configuration)) }
            .buttonStyle(.plain)
            .disabled(available.isEmpty)
            .accessibilityLabel("Reasoning effort")
            .accessibilityValue(store.effortName(configuration))
            .accessibilityIdentifier("configuration.effort")
            .popover(isPresented: $presented, arrowEdge: .bottom) {
                EffortPicker(configuration: $configuration, levels: available)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }
}

struct TextConfigLabel: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title).lineLimit(2)
        .font(.caption.weight(.medium))
        .foregroundStyle(DroidTheme.text)
        .padding(.horizontal, 7)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

private struct EffortPicker: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("hapticsEnabled") private var hapticsEnabled = true
    @Binding var configuration: SessionConfiguration
    let levels: [String]

    private var selected: String { configuration.remoteEffort ?? "" }
    private func title(_ level: String) -> String {
        SessionStore.effortTitle(level)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Reasoning effort").font(.subheadline.weight(.semibold))
                Spacer()
                Text(store.effortName(configuration)).font(.caption).foregroundStyle(DroidTheme.secondary)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(DroidTheme.separator).frame(height: 2)
                    let position = Double(levels.firstIndex(of: selected) ?? 0) / Double(max(1, levels.count - 1))
                    Capsule().fill(DroidTheme.text).frame(width: geometry.size.width * position, height: 2)
                    HStack(spacing: 0) {
                        ForEach(Array(levels.enumerated()), id: \.element) { index, level in
                            if index != 0 { Spacer(minLength: 0) }
                            Circle().fill(level == selected ? DroidTheme.text : DroidTheme.elevated)
                                .overlay(Circle().strokeBorder(DroidTheme.secondary, lineWidth: level == selected ? 0 : 1))
                                .frame(width: level == selected ? 18 : 8, height: level == selected ? 18 : 8)
                        }
                    }
                }
                .frame(height: 44)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                    guard !levels.isEmpty, geometry.size.width > 0 else { return }
                    let fraction = min(1, max(0, value.location.x / geometry.size.width))
                    choose(levels[Int((fraction * Double(levels.count - 1)).rounded())])
                })
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Reasoning effort")
                .accessibilityValue(store.effortName(configuration))
                .accessibilityAdjustableAction { direction in
                    guard let index = levels.firstIndex(of: selected) else { return }
                    switch direction {
                    case .increment: choose(levels[min(levels.count - 1, index + 1)])
                    case .decrement: choose(levels[max(0, index - 1)])
                    @unknown default: break
                    }
                }
            }
            .frame(height: 44)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 68))], spacing: 6) {
                ForEach(levels, id: \.self) { level in
                    Button(title(level)) { choose(level) }
                        .font(.caption.weight(level == selected ? .semibold : .regular))
                        .foregroundStyle(level == selected ? DroidTheme.text : DroidTheme.secondary)
                        .frame(minHeight: 44)
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(level == selected ? .isSelected : [])
                }
            }
            Text("Levels reported by this model on your computer.")
                .font(.caption).foregroundStyle(DroidTheme.secondary)
        }
        .padding(20)
        .frame(idealWidth: 320, maxWidth: 360)
        .presentationBackground(.regularMaterial)
        .sensoryFeedback(.selection, trigger: selected) { _, _ in hapticsEnabled }
    }

    private func choose(_ level: String) {
        guard level != selected else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.12)) {
            configuration.remoteEffort = level
        }
    }
}
