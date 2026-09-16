import DroidexCore
import SwiftUI

struct RemoteActivityView: View {
    @Environment(SessionStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let openSession: (UUID) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(store.sessions.sorted { $0.updatedAt > $1.updatedAt }) { session in
                        Button {
                            openSession(session.id)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 9) {
                                Text(session.title).font(.body.weight(.medium)).foregroundStyle(DroidTheme.text)
                                HStack {
                                    PhaseLabel(phase: session.phase)
                                    Spacer()
                                    Text(session.updatedAt, style: .relative).font(.caption).foregroundStyle(DroidTheme.secondary)
                                }
                                if let step = session.messages.last?.activity?.last?.title ?? session.messages.last?.steps.last {
                                    Text(step).font(.footnote).foregroundStyle(DroidTheme.secondary).lineLimit(2)
                                }
                            }.padding(.vertical, 8).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                    }
                } footer: {
                    Text(store.isConnected ? "Live state from your computer. Recent activity appears as the desktop sends it." : "Disconnected. These are the last received states, not a live view.")
                }
            }
            .listStyle(.plain).scrollContentBackground(.hidden).background(DroidTheme.background)
            .navigationTitle("Activity")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .refreshable { await store.refreshRemote() }
        }
    }
}
