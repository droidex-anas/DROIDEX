import DroidexCore
import SwiftUI

struct ReviewView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    var sessionID: UUID? = nil
    @State private var snapshot: ReviewSnapshot?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(store.workspaceName).font(.title2.weight(.semibold)).tracking(-0.5)
                        Text(store.isRemote ? "Working-tree changes" : "Illustrative changes")
                            .font(.subheadline).foregroundStyle(DroidTheme.secondary)
                        if loading { ProgressView("Reading changes…").font(.footnote) }
                        if let error { Text(error).font(.footnote).foregroundStyle(DroidTheme.danger) }
                    }
                    if let snapshot { ReviewContent(snapshot: snapshot) }
                    else if !loading && error == nil { Text("No review loaded.").foregroundStyle(DroidTheme.secondary) }
                    if let sessionID, let approval = store.session(sessionID)?.phase.approval {
                        ApprovalCard(approval: approval, busy: store.pendingActions.contains(sessionID)) {
                            store.respond(to: approval.id, in: sessionID, allow: $0)
                        }
                    }
                }
                .frame(maxWidth: 760).padding(22).frame(maxWidth: .infinity)
            }
            .background(DroidTheme.background)
            .navigationTitle("Changes").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) { Button("Refresh") { Task { await load() } }.disabled(loading) }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            if store.isRemote { snapshot = try await store.workspaceChanges() }
            else if let sessionID, let session = store.session(sessionID) {
                snapshot = ReviewSnapshot(changes: session.changes, note: "Bundled sample. This review does not change a repository.")
            }
        } catch is CancellationError { return }
        catch { self.error = error.localizedDescription }
    }
}

struct ReviewContent: View {
    let snapshot: ReviewSnapshot
    @State private var expanded: Set<String> = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(snapshot.note).font(.footnote).foregroundStyle(DroidTheme.secondary).fixedSize(horizontal: false, vertical: true)
        HStack {
            Text("\(snapshot.changes.count) files").font(.subheadline.weight(.medium))
            Spacer()
            DiffCounts(additions: snapshot.changes.reduce(0) { $0 + $1.additions }, deletions: snapshot.changes.reduce(0) { $0 + $1.deletions })
        }
        if snapshot.changes.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(snapshot.note.hasPrefix("Diff unavailable") ? "Review unavailable" : "No changes to show").font(.headline)
                Text("Refresh after the next edit. This view never applies changes.").font(.subheadline).foregroundStyle(DroidTheme.secondary)
            }.padding(.vertical, 24)
        }
        ForEach(snapshot.changes) { file in
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                        if expanded.contains(file.path) { expanded.remove(file.path) } else { expanded.insert(file.path) }
                    }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                            .rotationEffect(.degrees(expanded.contains(file.path) ? 90 : 0)).padding(.top, 3)
                        VStack(alignment: .leading, spacing: 7) {
                            Text(file.path).font(.subheadline.weight(.medium)).multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: 12) {
                                if let status = file.status { Text(status.capitalized).font(.caption2).foregroundStyle(DroidTheme.secondary) }
                                DiffCounts(additions: file.additions, deletions: file.deletions)
                            }
                        }
                        Spacer(minLength: 0)
                    }.padding(16).contentShape(Rectangle())
                }
                .buttonStyle(.plain).accessibilityLabel("\(expanded.contains(file.path) ? "Collapse" : "Expand") \(file.path)")
                if expanded.contains(file.path) {
                    if let note = file.note { Text(note).font(.footnote).foregroundStyle(DroidTheme.secondary).padding(.horizontal, 16).padding(.bottom, 10) }
                    if !file.lines.isEmpty { FileDiffContent(change: file) }
                }
            }
            .background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(DroidTheme.separator))
        }
    }
}

private struct FileDiffContent: View {
    let change: FileChange
    private var contentWidth: CGFloat {
        CGFloat(min(change.lines.map { $0.text.count }.max() ?? 0, 1_200) * 8 + 128)
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(change.lines.enumerated()), id: \.offset) { _, line in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(line.oldLine.map(String.init) ?? "").frame(width: 35, alignment: .trailing).foregroundStyle(DroidTheme.secondary)
                            Text(line.newLine.map(String.init) ?? "").frame(width: 35, alignment: .trailing).foregroundStyle(DroidTheme.secondary)
                            Text(line.prefix).frame(width: 10)
                            Text(line.text.isEmpty ? " " : line.text).textSelection(.enabled).fixedSize(horizontal: true, vertical: false)
                            Spacer(minLength: 0)
                        }
                        .font(.system(size: 12, design: .monospaced))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .foregroundStyle(line.kind == .addition ? DroidTheme.success : line.kind == .deletion ? DroidTheme.danger : DroidTheme.text)
                        .frame(width: max(geometry.size.width, contentWidth), alignment: .leading)
                        .background(background(line.kind))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(line.kind.rawValue), line \(line.newLine ?? line.oldLine ?? 0): \(line.text)")
                    }
                }
            }
        }
        .frame(height: min(420, CGFloat(change.lines.count * 23 + 12)))
        .clipShape(.rect(bottomLeadingRadius: 14, bottomTrailingRadius: 14))
        .accessibilityLabel("Code diff, scroll for more lines")
    }

    private func background(_ kind: DiffLine.Kind) -> Color {
        switch kind {
        case .addition: DroidTheme.success.opacity(0.08)
        case .deletion: DroidTheme.danger.opacity(0.08)
        case .hunk: DroidTheme.elevated
        case .context: .clear
        }
    }
}
