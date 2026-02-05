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
    @State private var showRenameAlert = false
    @State private var renameText = ""
    @State private var conversationToRename: Conversation?
    @State private var showMoveToFolder = false
    @State private var conversationToMove: Conversation?

    var searchText: String
    var onConversationSelected: ((Conversation) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Sub-tabs (underline indicator style matching Flutter)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(ChatHistoryTab.allCases, id: \.self) { tab in
                        let isActive = selectedTab == tab
                        Button(action: { selectedTab = tab }) {
                            VStack(spacing: 0) {
                                HStack(spacing: 6) {
                                    Image(systemName: tab.icon)
                                        .font(.system(size: 14))
                                    Text(tab.title(i18n))
                                        .font(.system(size: 12, weight: isActive ? .bold : .semibold))
                                }
                                .foregroundColor(isActive ? theme.primaryColor : theme.secondaryTextColor)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)

                                // Underline indicator
                                Rectangle()
                                    .fill(isActive ? theme.primaryColor : Color.clear)
                                    .frame(height: 3)
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
            }
            .frame(height: 48)
            .background(theme.surfaceColor)

            Divider()

            // Content
            ScrollView {
                LazyVStack(spacing: 0) {
                    switch selectedTab {
                    case .all:
                        conversationsList(historyService.getAllNonArchivedConversations())

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
        .alert(i18n.translate("sidebar.renameChat"), isPresented: $showRenameAlert) {
            TextField(i18n.translate("sidebar.renameChat"), text: $renameText)
            Button(i18n.translate("common.cancel"), role: .cancel) {}
            Button(i18n.translate("common.save")) {
                renameConversation()
            }
        }
        .sheet(isPresented: $showMoveToFolder) {
            MoveToFolderSheet(
                folders: historyService.folders,
                onSelect: moveConversationToFolder,
                onDismiss: {
                    showMoveToFolder = false
                    conversationToMove = nil
                }
            )
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
                    onRename: { promptRename(conversation) },
                    onMoveToFolder: { promptMoveToFolder(conversation) },
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
                        onRename: { promptRename(conversation) },
                        onMoveToFolder: { promptMoveToFolder(conversation) },
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

    private func promptRename(_ conversation: Conversation) {
        conversationToRename = conversation
        renameText = conversation.title
        showRenameAlert = true
    }

    private func renameConversation() {
        guard let conversation = conversationToRename, !renameText.isEmpty else { return }
        Task {
            _ = try? await historyService.updateConversation(
                id: conversation.id,
                updates: ["title": renameText]
            )
        }
    }

    private func promptMoveToFolder(_ conversation: Conversation) {
        conversationToMove = conversation
        showMoveToFolder = true
    }

    private func moveConversationToFolder(_ folderId: String) {
        guard let conversation = conversationToMove,
              let userId = authService.currentUser?.id else { return }
        Task {
            try? await historyService.addConversationToFolder(
                folderId: folderId,
                conversationId: conversation.id,
                userId: userId
            )
            showMoveToFolder = false
            conversationToMove = nil
        }
    }
}

// MARK: - Conversation Row

struct ConversationRow: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let conversation: Conversation
    var onTapped: () -> Void
    var onRename: (() -> Void)?
    var onMoveToFolder: (() -> Void)?
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
                    if let onRename {
                        Button {
                            onRename()
                        } label: {
                            SwiftUI.Label(i18n.translate("sidebar.renameChat"), systemImage: "pencil")
                        }
                    }

                    if let onMoveToFolder {
                        Button {
                            onMoveToFolder()
                        } label: {
                            SwiftUI.Label(i18n.translate("sidebar.moveChat"), systemImage: "folder")
                        }
                    }

                    Button {
                        onStar()
                    } label: {
                        SwiftUI.Label(
                            conversation.isStarred ? i18n.translate("sidebar.unstar") : i18n.translate("sidebar.star"),
                            systemImage: conversation.isStarred ? "star.slash" : "star"
                        )
                    }

                    Button {
                        onArchive()
                    } label: {
                        SwiftUI.Label(
                            conversation.isArchived ? i18n.translate("sidebar.unarchive") : i18n.translate("sidebar.archive"),
                            systemImage: "archivebox"
                        )
                    }

                    Divider()

                    Button(role: .destructive, action: onDelete) {
                        SwiftUI.Label(i18n.translate("sidebar.deleteChat"), systemImage: "trash")
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

// MARK: - Move to Folder Sheet

struct MoveToFolderSheet: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let folders: [Folder]
    var onSelect: (String) -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(folders) { folder in
                    Button {
                        onSelect(folder.id)
                    } label: {
                        HStack {
                            Image(systemName: "folder")
                                .foregroundColor(theme.primaryColor)
                            Text(folder.name)
                                .foregroundColor(theme.primaryTextColor)
                        }
                    }
                }
            }
            .navigationTitle(i18n.translate("sidebar.moveChatTo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(i18n.translate("common.cancel"), action: onDismiss)
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
