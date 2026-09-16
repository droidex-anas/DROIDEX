import DroidexCore
import SwiftUI

@main
struct DroidexApp: App {
    @State private var connection = AppConnection()
    @AppStorage("appearance") private var appearance = "system"

    var body: some Scene {
        WindowGroup {
            Group {
                if let store = connection.store {
                    AppRoot().environment(store).id(ObjectIdentifier(store))
                } else {
                    OnboardingView()
                }
            }
            .environment(connection)
            .tint(DroidTheme.text)
            .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
            .task { connection.restore() }
        }
    }
}

struct AppRoot: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selection: UUID?
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
    @State private var compactColumn: NavigationSplitViewColumn = .sidebar

    var body: some View {
        Group {
            switch store.loadState {
            case .loading:
                ProgressView("Opening saved conversations")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ContentUnavailableView("Could not open conversations", systemImage: "externaldrive", description: Text(message))
            case .ready:
                Group {
                    if sizeClass == .compact {
                        NavigationStack(path: Binding(get: { selection.map { [$0] } ?? [] }, set: { selection = $0.last })) {
                            InboxView(selection: $selection)
                                .navigationDestination(for: UUID.self) { id in ConversationView(sessionID: id).id(id) }
                        }
                    } else {
                        NavigationSplitView(columnVisibility: $columnVisibility, preferredCompactColumn: $compactColumn) {
                            InboxView(selection: $selection)
                                .navigationSplitViewColumnWidth(min: 290, ideal: 350, max: 430)
                        } detail: {
                            if let selection, store.session(selection) != nil {
                                ConversationView(sessionID: selection)
                                    .id(selection)
                            } else {
                                ContentUnavailableView {
                                    BrandMark().frame(width: 148, height: 20)
                                } description: {
                                    Text("Select a session, or start something new.")
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .background(DroidTheme.background)
                            }
                        }
                        .navigationSplitViewStyle(.balanced)
                        .onChange(of: selection) { _, value in
                            compactColumn = value == nil ? .sidebar : .detail
                        }
                    }
                }
                .onChange(of: store.sessions.map(\.appSessionId)) { _, ids in
                    if let selected = selection, !ids.contains(selected) { selection = nil }
                }
            }
        }
        .foregroundStyle(DroidTheme.text)
        .background(DroidTheme.background)
        .safeAreaInset(edge: .top, spacing: 0) {
            if store.loadState == .ready, !store.isConnected || store.connectionError != nil {
                Button { Task { await store.reconnect() } } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(store.isConnecting ? "Connecting to your computer…" : "Offline · saved on this phone").fontWeight(.medium)
                        if let synced = store.lastSyncedAt {
                            Text("Last received \(synced.formatted(date: .abbreviated, time: .shortened)). Tap to reconnect.")
                        } else {
                            Text("Connect your computer to receive conversations. You can write a draft offline.")
                        }
                    }
                    .font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).background(DroidTheme.surface)
                }.buttonStyle(.plain).disabled(store.isConnecting).foregroundStyle(DroidTheme.secondary)
            }
            if let error = store.storageError {
                Button {
                    Task { await store.flush() }
                } label: {
                    Label(error + " Tap to retry.", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(DroidTheme.surface)
                }
                .buttonStyle(.plain)
                .foregroundStyle(DroidTheme.warning)
            }
        }
        .task { await store.load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { Task { await store.suspend() } }
            else if phase == .active { Task { await store.load() } }
        }
    }
}
