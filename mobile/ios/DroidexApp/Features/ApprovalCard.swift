import DroidexCore
import SwiftUI

struct ApprovalCard: View {
    @Environment(SessionStore.self) private var store
    let approval: Approval
    var busy = false
    let respond: (Bool) -> Void
    @State private var fullPlan = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(approval.isPlan ? "PLAN REVIEW" : "NEEDS YOUR APPROVAL")
                        .font(.caption2.weight(.semibold)).tracking(1).foregroundStyle(DroidTheme.secondary)
                    Text(approval.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            if approval.isPlan {
                MarkdownContent(source: String(approval.detail.prefix(1_200)))
                Button("Read full plan") { fullPlan = true }.font(.subheadline).frame(minHeight: 44)
            } else {
                Text(approval.detail).textSelection(.enabled).font(.callout)
                    .foregroundStyle(DroidTheme.secondary).lineLimit(12)
                Button("Read full request") { fullPlan = true }.font(.subheadline).frame(minHeight: 44)
            }
            Text(store.isRemote ? "Approval runs on your computer and can change real files." : "Preview only. No command is executed.")
                .font(.footnote).foregroundStyle(DroidTheme.secondary)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { actions }.fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 10) { actions }
            }
            if busy { ProgressView("Waiting for the computer…").font(.footnote) }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(DroidTheme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(DroidTheme.separator))
        .sheet(isPresented: $fullPlan) {
            NavigationStack {
                ScrollView { MarkdownContent(source: approval.detail).padding(22).frame(maxWidth: 740).frame(maxWidth: .infinity) }
                    .background(DroidTheme.background)
                    .navigationTitle(approval.isPlan ? "Plan" : "Approval request").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { fullPlan = false } } }
            }
        }
    }

    @ViewBuilder private var actions: some View {
        Button(store.isRemote ? (approval.isPlan ? "Approve plan & build" : "Approve once") : "Approve preview") { respond(true) }
            .buttonStyle(.borderedProminent).tint(DroidTheme.text).foregroundStyle(DroidTheme.background)
            .controlSize(.large).disabled(!store.canSend || busy).accessibilityIdentifier("approval.allow")
        Button(approval.isPlan ? "Decline plan" : "Decline") { respond(false) }
            .buttonStyle(.bordered).controlSize(.large).disabled(!store.canSend || busy).accessibilityIdentifier("approval.decline")
    }
}
