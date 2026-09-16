import DroidexCore
import SwiftUI

struct AgentStepsView: View {
    let steps: [String]
    var activity: [AgentActivity] = []
    let isRunning: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false
    @State private var opened: Set<String> = []

    private var summary: String {
        guard let latest = activity.last else { return steps.last ?? "Working" }
        if let running = activity.last(where: { $0.status == .running }) { return running.title }
        return latest.status == .failed ? latest.title + " failed" : latest.title
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { expanded.toggle() }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .frame(width: 12)
                    WorkingLabel(text: summary, active: isRunning)
                    Spacer(minLength: 4)
                    if !isRunning { Text("\(activity.isEmpty ? steps.count : activity.count)").font(.caption2).monospacedDigit() }
                }
                .font(.footnote).foregroundStyle(DroidTheme.secondary)
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(expanded ? "Hide agent activity" : "Show agent activity")
            .accessibilityValue(summary)
            .accessibilityIdentifier("activity.disclosure")
            if expanded {
                VStack(alignment: .leading, spacing: 2) {
                    if activity.isEmpty {
                        ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                            Text(step).font(.footnote).foregroundStyle(DroidTheme.secondary).padding(.vertical, 6)
                        }
                    } else {
                        ForEach(activity) { item in activityRow(item) }
                    }
                }
                .padding(.leading, 20).padding(.bottom, 10)
                .overlay(alignment: .leading) { Rectangle().fill(DroidTheme.separator).frame(width: 1).padding(.leading, 5) }
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func activityRow(_ item: AgentActivity) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
                    if opened.contains(item.id) { opened.remove(item.id) } else { opened.insert(item.id) }
                }
            } label: {
                HStack(spacing: 8) {
                    if item.detail?.isEmpty == false {
                        Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold))
                            .rotationEffect(.degrees(opened.contains(item.id) ? 90 : 0))
                    }
                    WorkingLabel(text: item.title, active: isRunning && item.status == .running)
                    Spacer(minLength: 8)
                    Text(status(item)).font(.caption2).foregroundStyle(item.status == .failed ? DroidTheme.danger : DroidTheme.secondary)
                }
                .font(.footnote).foregroundStyle(DroidTheme.text).frame(minHeight: 40).contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(item.detail?.isEmpty != false)
            .accessibilityValue(status(item))
            if opened.contains(item.id), let detail = item.detail {
                if item.kind == .thinking {
                    MarkdownContent(source: detail).font(.footnote).foregroundStyle(DroidTheme.secondary)
                } else {
                    ScrollView(.horizontal) {
                        Text(detail).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: false).padding(12)
                    }
                    .background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    private func status(_ item: AgentActivity) -> String {
        switch item.status {
        case .running: return isRunning ? "Working" : "No result reported"
        case .completed: return "Done"
        case .failed: return "Failed"
        case .interrupted: return "Interrupted"
        }
    }
}

struct WorkingLabel: View {
    @State private var visible = false
    let text: String
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Text(text).lineLimit(1)
            .overlay {
                if active && visible && !reduceMotion && scenePhase == .active {
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                        GeometryReader { geometry in
                            let progress = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
                            LinearGradient(colors: [.clear, DroidTheme.text.opacity(0.7), .clear], startPoint: .leading, endPoint: .trailing)
                                .frame(width: geometry.size.width * 0.55)
                                .offset(x: geometry.size.width * (progress * 1.7 - 0.6))
                        }
                    }
                    .mask(Text(text).lineLimit(1))
                    .allowsHitTesting(false).accessibilityHidden(true)
                }
            }
            .onAppear { visible = true }
            .onDisappear { visible = false }
    }
}
