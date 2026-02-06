// RightSidebarView.swift
// Right sidebar with related documents and FAQ

import SwiftUI

struct RightSidebarView: View {
    @Environment(ThemeManager.self) private var theme

    var relatedDocs: [DocumentItem]
    var faqItems: [FAQItem]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Header
                Text("Info & Resources")
                    .font(.headline)
                    .fontWeight(.bold)
                    .padding(.horizontal)

                // Related Documents Section
                VStack(alignment: .leading, spacing: 12) {
                    Text("Related Documents")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(theme.secondaryTextColor)
                        .padding(.horizontal)

                    if relatedDocs.isEmpty {
                        Text("No related documents")
                            .font(.caption)
                            .foregroundColor(theme.secondaryTextColor)
                            .padding(.horizontal)
                    } else {
                        ForEach(relatedDocs) { doc in
                            DocumentRow(document: doc)
                        }
                    }
                }

                Divider()
                    .padding(.horizontal)

                // FAQ Section
                VStack(alignment: .leading, spacing: 12) {
                    Text("Frequently Asked Questions")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(theme.secondaryTextColor)
                        .padding(.horizontal)

                    ForEach(faqItems) { item in
                        FAQRow(item: item)
                    }
                }

                Spacer()
            }
            .padding(.vertical)
        }
        .background(theme.surfaceColor)
    }
}

// MARK: - Document Item

struct DocumentItem: Identifiable {
    let id = UUID()
    let title: String
    let url: String
    let type: DocumentType

    enum DocumentType {
        case pdf
        case web
        case video

        var icon: String {
            switch self {
            case .pdf: return "doc.fill"
            case .web: return "globe"
            case .video: return "play.rectangle.fill"
            }
        }

        var color: Color {
            switch self {
            case .pdf: return .red
            case .web: return .blue
            case .video: return .purple
            }
        }
    }
}

struct DocumentRow: View {
    @Environment(ThemeManager.self) private var theme

    let document: DocumentItem

    var body: some View {
        Link(destination: URL(string: document.url)!) {
            HStack(spacing: 12) {
                Image(systemName: document.type.icon)
                    .foregroundColor(document.type.color)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(document.title)
                        .font(.subheadline)
                        .foregroundColor(theme.primaryTextColor)
                        .lineLimit(2)
                }

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }
}

// MARK: - FAQ Item

struct FAQItem: Identifiable {
    let id = UUID()
    let question: String
    let answer: String
}

struct FAQRow: View {
    @Environment(ThemeManager.self) private var theme

    let item: FAQItem
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: { withAnimation { isExpanded.toggle() } }) {
                HStack {
                    Text(item.question)
                        .font(.subheadline)
                        .foregroundColor(theme.primaryTextColor)
                        .multilineTextAlignment(.leading)

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                }
            }
            .padding(.horizontal)

            if isExpanded {
                Text(item.answer)
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .padding(.horizontal)
                    .padding(.bottom, 8)
            }

            Divider()
                .padding(.leading)
        }
    }
}

#Preview {
    RightSidebarView(
        relatedDocs: [
            DocumentItem(title: "How to Apply for National ID", url: "https://example.com", type: .pdf),
            DocumentItem(title: "Huduma Centre Locations", url: "https://example.com", type: .web)
        ],
        faqItems: [
            FAQItem(question: "What documents do I need for ID application?", answer: "You need your birth certificate and copies of your parents' IDs."),
            FAQItem(question: "How long does it take to get an ID?", answer: "It typically takes 2-4 weeks after application.")
        ]
    )
    .frame(width: 300)
    .environment(ThemeManager())
}
