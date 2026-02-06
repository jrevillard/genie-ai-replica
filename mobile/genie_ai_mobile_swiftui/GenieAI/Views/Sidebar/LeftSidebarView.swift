// LeftSidebarView.swift
// Left sidebar with services and chat history tabs

import SwiftUI

enum LeftSidebarTab: String, CaseIterable {
    case services = "services"
    case history = "history"

    var icon: String {
        switch self {
        case .services: return "square.grid.2x2"
        case .history: return "clock"
        }
    }

    var localizedTitle: String {
        switch self {
        case .services: return String(localized: "Knowledge Areas")
        case .history: return String(localized: "Chat History")
        }
    }
}

struct LeftSidebarView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(AuthService.self) private var authService

    @State private var selectedTab: LeftSidebarTab = .services
    @State private var searchText = ""

    var onConversationSelected: ((Conversation) -> Void)?
    var onServiceSelectionChanged: ((_ categoryId: String, _ name: String, _ contextLabels: String) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Tab Selector
            HStack(spacing: 0) {
                ForEach(LeftSidebarTab.allCases, id: \.self) { tab in
                    Button(action: { selectedTab = tab }) {
                        VStack(spacing: 4) {
                            Image(systemName: tab.icon)
                                .font(.title3)

                            Text(tab.localizedTitle)
                                .font(.caption2)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(selectedTab == tab ? theme.primaryColor.opacity(0.1) : Color.clear)
                        .foregroundColor(selectedTab == tab ? theme.primaryColor : theme.secondaryTextColor)
                    }
                }
            }
            .background(theme.secondarySurfaceColor)

            Divider()

            // Search Field
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(theme.secondaryTextColor)

                TextField("Search knowledge areas...", text: $searchText)
                    .textFieldStyle(.plain)

                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
            .padding(8)
            .background(theme.secondarySurfaceColor)
            .cornerRadius(8)
            .padding()

            // Content
            switch selectedTab {
            case .services:
                ServiceTreeView(
                    searchText: searchText,
                    onSelectionChanged: onServiceSelectionChanged
                )

            case .history:
                ChatHistoryView(
                    searchText: searchText,
                    onConversationSelected: onConversationSelected
                )
            }
        }
        .background(theme.surfaceColor)
    }
}

#Preview {
    LeftSidebarView()
        .frame(width: 300)
        .environment(ThemeManager())
        .environment(AuthService())
}
