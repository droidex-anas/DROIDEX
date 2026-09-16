import DroidexCore
import SwiftUI

struct PullRequestsView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var requests: [RemotePullRequest] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Open pull requests for \(store.workspaceName). Read-only review using GitHub sign-in on your computer.")
                        .font(.footnote).foregroundStyle(DroidTheme.secondary).listRowBackground(Color.clear)
                }
                if let error {
                    Section {
                        Text(error).font(.callout)
                        Button("Try again") { Task { await load() } }
                    }.listRowBackground(DroidTheme.surface)
                }
                if loading { ProgressView("Loading pull requests…").listRowBackground(Color.clear) }
                if !loading && error == nil && requests.isEmpty {
                    Text("No open pull requests.").foregroundStyle(DroidTheme.secondary).listRowBackground(Color.clear)
                }
                ForEach(requests) { request in
                    NavigationLink {
                        PullRequestDetailView(request: request)
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(request.title).font(.body.weight(.medium))
                            Text("#\(request.number) · \(request.isDraft ? "Draft" : request.state.capitalized) · \(request.headRefName) → \(request.baseRefName)")
                                .font(.caption).foregroundStyle(DroidTheme.secondary)
                        }.padding(.vertical, 8)
                    }.listRowBackground(DroidTheme.surface)
                }
            }
            .scrollContentBackground(.hidden).background(DroidTheme.background)
            .navigationTitle("Pull requests").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }.refreshable { await load() }
        }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do { requests = try await store.pullRequests() }
        catch is CancellationError { return }
        catch { self.error = error.localizedDescription }
    }
}

private struct PullRequestDetailView: View {
    @Environment(SessionStore.self) private var store
    let request: RemotePullRequest
    @State private var detail: PullRequestReview?
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                Text(request.title).font(.title2.weight(.semibold)).tracking(-0.4)
                Text("\(request.headRefName) → \(request.baseRefName)").font(.footnote).foregroundStyle(DroidTheme.secondary)
                if request.url.scheme == "https" { Link("Open on GitHub", destination: request.url).font(.subheadline) }
                if loading { ProgressView("Loading description and diff…") }
                if let error { Text(error).foregroundStyle(DroidTheme.danger); Button("Try again") { Task { await load() } } }
                if let detail {
                    if !detail.body.isEmpty { MarkdownContent(source: detail.body) }
                    Divider()
                    ReviewContent(snapshot: detail.review)
                }
            }
            .frame(maxWidth: 760).padding(22).frame(maxWidth: .infinity)
        }
        .background(DroidTheme.background)
        .navigationTitle("#\(request.number)").navigationBarTitleDisplayMode(.inline)
        .task(id: request.number) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do { detail = try await store.pullRequest(request.number) }
        catch is CancellationError { return }
        catch { self.error = error.localizedDescription }
    }
}
