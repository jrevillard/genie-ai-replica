// RelatedDocsStore.swift
// Observable store for the "Related Documents" list surfaced in the
// Info & Resources sidebar.
//
// Why this exists instead of plain @State on ContentView:
//
// The sidebar is presented two ways depending on screen size — inline
// in a wide-screen 3-column layout, and inside a .sheet on mobile. The
// mobile sheet pathway has a SwiftUI quirk where the sheet's content
// closure captures referenced @State at presentation time, and then
// (in nested hierarchies with GeometryReader + @ViewBuilder helpers +
// sheet modifiers) does NOT re-evaluate when the parent's @State
// mutates. Concretely: ContentView's @State relatedDocs would update
// (proven by callback log `total=1`), but the sheet's RightSidebarView
// kept reading `relatedDocs=0` on every body render.
//
// The Observation framework's tracking flows through any depth of view
// hierarchy — including modal presentations — because views directly
// access the observed properties of the @Observable instance at body-
// eval time. Replacing @State with an @Environment-injected
// @Observable class fixes the propagation without changing the rest of
// the UI code's shape.

import Foundation
import Observation

@Observable
final class RelatedDocsStore {
    var docs: [DocumentItem] = []

    /// Appends new documents, deduplicating against what's already present
    /// using a composite key (url ?? documentId ?? title) — see the rationale
    /// in commit 720668b1. Returns the number of docs actually appended.
    @discardableResult
    func append(_ incoming: [DocumentItem]) -> Int {
        func key(_ d: DocumentItem) -> String {
            return d.url ?? d.documentId ?? d.title
        }
        var seen = Set(docs.map(key))
        var unique: [DocumentItem] = []
        for d in incoming where !seen.contains(key(d)) {
            seen.insert(key(d))
            unique.append(d)
        }
        docs.append(contentsOf: unique)
        return unique.count
    }

    /// Wipes the list — used by startNewChat / loadConversation.
    func clear() {
        docs = []
    }
}
