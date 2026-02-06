// LeftSidebarView.swift
// Left sidebar with services and chat history tabs — Liquid Glass design

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
    @Namespace private var tabNamespace

    var onConversationSelected: ((Conversation) -> Void)?
    var onServiceSelectionChanged: ((_ categoryId: String, _ name: String, _ contextLabels: String) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Glass pill tab selector
            HStack(spacing: 0) {
                ForEach(LeftSidebarTab.allCases, id: \.self) { tab in
                    let isActive = selectedTab == tab
                    Button {
                        withAnimation(theme.animationSmooth) {
                            selectedTab = tab
                        }
                        if theme.hapticsEnabled {
                            UISelectionFeedbackGenerator().selectionChanged()
                        }
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: tab.icon)
                                .font(.title3)

                            Text(tab.localizedTitle)
                                .font(.caption2)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .foregroundColor(isActive ? theme.primaryColor : theme.secondaryTextColor)
                        .background {
                            if isActive {
                                RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous)
                                    .fill(.thinMaterial)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous)
                                            .stroke(theme.glassBorder, lineWidth: 1)
                                    )
                                    .shadow(theme.shadowSoft)
                                    .matchedGeometryEffect(id: "activeTab", in: tabNamespace)
                                    .padding(theme.spacingXS)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, theme.spacingXS)
            .background(.ultraThinMaterial)

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
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous))
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
    }
}

#Preview {
    LeftSidebarView()
        .frame(width: 300)
        .environment(ThemeManager())
        .environment(AuthService())
}
