// ChatHistoryView.swift
// Chat history list with folders

import SwiftUI

enum ChatHistoryTab: String, CaseIterable {
    case all
    case folders
    case starred
    case archived

    var icon: String {
        switch self {
        case .all: return "bubble.left.and.bubble.right"
        case .folders: return "folder"
        case .starred: return "star"
        case .archived: return "archivebox"
        }
    }

    func title(_ i18n: I18nService) -> String {
        switch self {
        case .all: return i18n.translate("sidebar.tab.all")
        case .folders: return i18n.translate("sidebar.tab.folders")
        case .starred: return i18n.translate("sidebar.tab.starred")
        case .archived: return i18n.translate("sidebar.tab.archived")
        }
    }
}

struct ChatHistoryView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(AuthService.self) private var authService

    @State private var historyService = ChatHistoryService()
    @State private var selectedTab: ChatHistoryTab = .all
    @State private var showCreateFolder = false
    @State private var selectedFolder: Folder?

    var searchText: String
    var onConversationSelected: ((Conversation) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Sub-tabs
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ChatHistoryTab.allCases, id: \.self) { tab in
                        Button(action: { selectedTab = tab }) {
                            HStack(spacing: 4) {
                                Image(systemName: tab.icon)
                                    .font(.caption)
                                Text(tab.title(i18n))
                                    .font(.caption)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(selectedTab == tab ? theme.primaryColor : theme.secondarySurfaceColor)
                            .foregroundColor(selectedTab == tab ? .white : theme.primaryTextColor)
                            .cornerRadius(16)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }

            Divider()

            // Content
            ScrollView {
                LazyVStack(spacing: 0) {
                    switch selectedTab {
                    case .all:
                        conversationsList(historyService.getUnfolderedConversations())

                    case .folders:
                        foldersList()

                    case .starred:
                        conversationsList(historyService.getStarredConversations())

                    case .archived:
                        conversationsList(historyService.getArchivedConversations())
                    }
                }
            }
        }
        .task {
            await loadData()
        }
        .sheet(isPresented: $showCreateFolder) {
            CreateFolderSheet(onSave: createFolder, onDismiss: { showCreateFolder = false })
        }
    }

    @ViewBuilder
    private func conversationsList(_ conversations: [Conversation]) -> some View {
        let filtered = filterConversations(conversations)

        if historyService.isLoading {
            ProgressView()
                .padding()
        } else if filtered.isEmpty {
            Text(i18n.translate("sidebar.noChats"))
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
                .padding()
        } else {
            ForEach(filtered) { conversation in
                ConversationRow(
                    conversation: conversation,
                    onTapped: { onConversationSelected?(conversation) },
                    onStar: { toggleStar(conversation) },
                    onArchive: { toggleArchive(conversation) },
                    onDelete: { deleteConversation(conversation) }
                )
            }
        }
    }

    @ViewBuilder
    private func foldersList() -> some View {
        // Create Folder Button
        Button(action: { showCreateFolder = true }) {
            HStack {
                Image(systemName: "plus.circle.fill")
                Text(i18n.translate("sidebar.createFolder"))
            }
            .font(.subheadline)
            .foregroundColor(theme.primaryColor)
            .padding()
        }

        ForEach(historyService.folders) { folder in
            FolderRow(
                folder: folder,
                isExpanded: selectedFolder?.id == folder.id,
                conversationCount: historyService.getConversationsInFolder(folder.id).count,
                onToggle: {
                    withAnimation {
                        selectedFolder = selectedFolder?.id == folder.id ? nil : folder
                    }
                },
                onDelete: { deleteFolder(folder) }
            )

            if selectedFolder?.id == folder.id {
                let conversations = historyService.getConversationsInFolder(folder.id)
                ForEach(conversations) { conversation in
                    ConversationRow(
                        conversation: conversation,
                        onTapped: { onConversationSelected?(conversation) },
                        onStar: { toggleStar(conversation) },
                        onArchive: { toggleArchive(conversation) },
                        onDelete: { deleteConversation(conversation) }
                    )
                    .padding(.leading, 20)
                }
            }
        }
    }

    private func filterConversations(_ conversations: [Conversation]) -> [Conversation] {
        if searchText.isEmpty {
            return conversations
        }
        return conversations.filter {
            $0.title.localizedCaseInsensitiveContains(searchText) ||
            $0.preview.localizedCaseInsensitiveContains(searchText)
        }
    }

    private func loadData() async {
        guard let userId = authService.currentUser?.id else { return }

        do {
            try await historyService.getUserConversations(userId: userId)
            try await historyService.getUserFolders(userId: userId)
        } catch {
            print("[ChatHistoryView] Load error: \(error)")
        }
    }

    private func toggleStar(_ conversation: Conversation) {
        Task {
            _ = try? await historyService.updateConversation(
                id: conversation.id,
                updates: ["isStarred": !conversation.isStarred]
            )
        }
    }

    private func toggleArchive(_ conversation: Conversation) {
        Task {
            _ = try? await historyService.updateConversation(
                id: conversation.id,
                updates: ["isArchived": !conversation.isArchived]
            )
        }
    }

    private func deleteConversation(_ conversation: Conversation) {
        guard let userId = authService.currentUser?.id else { return }
        Task {
            try? await historyService.deleteConversation(id: conversation.id, userId: userId)
        }
    }

    private func createFolder(name: String) {
        guard let userId = authService.currentUser?.id else { return }
        Task {
            _ = try? await historyService.createFolder(name: name, userId: userId)
            showCreateFolder = false
        }
    }

    private func deleteFolder(_ folder: Folder) {
        guard let userId = authService.currentUser?.id else { return }
        Task {
            try? await historyService.deleteFolder(id: folder.id, userId: userId)
        }
    }
}

// MARK: - Conversation Row

struct ConversationRow: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let conversation: Conversation
    var onTapped: () -> Void
    var onStar: () -> Void
    var onArchive: () -> Void
    var onDelete: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(conversation.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)

                        if conversation.isStarred {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundColor(.yellow)
                        }
                    }

                    Text(conversation.preview)
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                        .lineLimit(1)

                    Text(formatDate(conversation.updatedAt))
                        .font(.caption2)
                        .foregroundColor(theme.secondaryTextColor)
                }

                Spacer()

                Menu {
                    Button {
                        onStar()
                    } label: {
                        HStack {
                            Image(systemName: conversation.isStarred ? "star.slash" : "star")
                            Text(conversation.isStarred ? i18n.translate("sidebar.unstar") : i18n.translate("sidebar.star"))
                        }
                    }

                    Button {
                        onArchive()
                    } label: {
                        HStack {
                            Image(systemName: "archivebox")
                            Text(i18n.translate("sidebar.archive"))
                        }
                    }

                    Divider()

                    Button(role: .destructive, action: onDelete) {
                        HStack {
                            Image(systemName: "trash")
                            Text(i18n.translate("sidebar.deleteChat"))
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundColor(theme.secondaryTextColor)
                        .padding(8)
                }
            }
            .padding()
            .contentShape(Rectangle())
            .onTapGesture(perform: onTapped)

            Divider()
                .padding(.leading)
        }
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Folder Row

struct FolderRow: View {
    @Environment(ThemeManager.self) private var theme

    let folder: Folder
    let isExpanded: Bool
    let conversationCount: Int
    var onToggle: () -> Void
    var onDelete: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: isExpanded ? "folder.fill" : "folder")
                    .foregroundColor(theme.primaryColor)

                Text(folder.name)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Spacer()

                Text("\(conversationCount)")
                    .font(.caption2)
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.secondaryColor)
                    .cornerRadius(8)

                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
            }
            .padding()
            .contentShape(Rectangle())
            .onTapGesture(perform: onToggle)

            Divider()
                .padding(.leading)
        }
    }
}

// MARK: - Create Folder Sheet

struct CreateFolderSheet: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var folderName = ""

    var onSave: (String) -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                TextField(i18n.translate("sidebar.folderNamePlaceholder"), text: $folderName)
                    .textFieldStyle(GenieTextFieldStyle())
                    .padding()

                Spacer()
            }
            .navigationTitle(i18n.translate("sidebar.createFolder"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(i18n.translate("common.cancel"), action: onDismiss)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(i18n.translate("common.create")) {
                        onSave(folderName)
                    }
                    .disabled(folderName.isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

#Preview {
    ChatHistoryView(searchText: "")
        .environment(ThemeManager())
        .environment(I18nService())
        .environment(AuthService())
}
