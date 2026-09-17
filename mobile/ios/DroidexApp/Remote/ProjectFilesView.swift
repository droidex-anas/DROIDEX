import DroidexCore
import SwiftUI

struct ProjectFilesView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ProjectDirectoryView(path: "", title: store.workspaceName)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

private struct ProjectDirectoryView: View {
    @Environment(SessionStore.self) private var store
    let path: String
    let title: String
    @State private var entries: [RemoteFileEntry] = []
    @State private var nextCursor: String?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        List {
            Section {
                ForEach(entries) { entry in
                    if entry.directory {
                        NavigationLink {
                            ProjectDirectoryView(path: entry.path, title: entry.name)
                        } label: {
                            HStack { Text(entry.name); Spacer(); Text("Folder").font(.caption).foregroundStyle(DroidTheme.secondary) }
                                .padding(.vertical, 6)
                        }
                    } else {
                        NavigationLink(entry.name) { ProjectFileView(path: entry.path, title: entry.name) }
                            .padding(.vertical, 6)
                    }
                }
            } footer: {
                Text("Files load only as you open folders. Symbolic links, dependency folders, and common credential files are not shared.")
            }
            if loading { ProgressView("Loading files").frame(maxWidth: .infinity).listRowBackground(Color.clear) }
            if let error {
                Section {
                    Text(error).foregroundStyle(DroidTheme.danger)
                    Button("Try again") { Task { await load(more: !entries.isEmpty) } }
                }
            } else if nextCursor != nil {
                Button("Load more files") { Task { await load(more: true) } }.disabled(loading)
            } else if entries.isEmpty && !loading {
                Text("No shared files in this folder").foregroundStyle(DroidTheme.secondary)
            }
        }
        .listStyle(.plain).scrollContentBackground(.hidden).background(DroidTheme.background)
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        .task(id: path) { await load(more: false) }
        .refreshable { await load(more: false) }
    }

    private func load(more: Bool) async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let page = try await store.remoteFiles(path: path, cursor: more ? nextCursor : nil)
            try Task.checkCancellation()
            if more {
                let existing = Set(entries.map(\.id))
                entries += page.entries.filter { !existing.contains($0.id) }
            } else { entries = page.entries }
            nextCursor = page.nextCursor
        } catch is CancellationError { return }
        catch { self.error = error.localizedDescription }
    }
}

private struct ProjectFileView: View {
    @Environment(SessionStore.self) private var store
    let path: String
    let title: String
    @State private var content: RemoteFileContent?
    @State private var error: String?

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 16) {
                if let content {
                    Text(content.text).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                    if content.truncated {
                        Text("Showing the first 64 KB. Open the complete file on your computer.")
                            .font(.footnote).foregroundStyle(DroidTheme.secondary)
                    }
                } else if let error {
                    Text(error).font(.callout).foregroundStyle(DroidTheme.danger)
                } else { ProgressView("Opening file") }
            }.padding(20)
        }
        .background(DroidTheme.background)
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        .task(id: path) {
            do { content = try await store.remoteFile(path: path) }
            catch is CancellationError { return }
            catch { self.error = error.localizedDescription }
        }
    }
}
