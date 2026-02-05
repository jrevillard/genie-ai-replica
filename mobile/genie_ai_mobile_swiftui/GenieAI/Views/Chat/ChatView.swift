// ChatView.swift
// Main chat interface

import SwiftUI

struct ChatView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var chatService = ChatService()
    @State private var messages: [Message] = []
    @State private var sessionId = UUID().uuidString
    @State private var inputText = ""
    @State private var isLoading = false
    @State private var showFeedbackSheet = false
    @State private var selectedMessageForFeedback: Message?
    @State private var selectedCategoryId: String?
    @State private var contextLabels: String?

    var onNewChat: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Messages List
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        // Welcome message when empty
                        if messages.isEmpty {
                            WelcomeView()
                                .padding()

                            // Quick Help Grid
                            QuickHelpGrid(onButtonTapped: handleQuickHelp)
                                .padding(.horizontal)
                        }

                        // Messages
                        ForEach(messages) { message in
                            MessageBubble(
                                message: message,
                                onFeedbackTapped: {
                                    selectedMessageForFeedback = message
                                    showFeedbackSheet = true
                                }
                            )
                            .id(message.id)
                        }

                        // Loading indicator
                        if isLoading {
                            HStack {
                                ProgressView()
                                Text(i18n.translate("chatbot.thinking"))
                                    .font(.subheadline)
                                    .foregroundColor(theme.secondaryTextColor)
                            }
                            .padding()
                        }
                    }
                    .padding(.vertical)
                }
                .onChange(of: messages.count) { _, _ in
                    if let lastMessage = messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Input Area
            ChatInputView(
                text: $inputText,
                isLoading: isLoading,
                onSend: sendMessage,
                onAttach: handleAttachment
            )
        }
        .sheet(isPresented: $showFeedbackSheet) {
            if let message = selectedMessageForFeedback {
                FeedbackSheet(
                    message: message,
                    onSubmit: submitFeedback,
                    onDismiss: { showFeedbackSheet = false }
                )
            }
        }
    }

    // MARK: - Welcome View

    @ViewBuilder
    private func WelcomeView() -> some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 50))
                .foregroundStyle(theme.navbarGradient)

            Text(ConfigService.shared.botName)
                .font(.title)
                .fontWeight(.bold)

            Text(i18n.translate("chatbot.whatCanIHelp"))
                .font(.headline)
                .foregroundColor(theme.secondaryTextColor)
        }
        .padding(.top, 40)
    }

    // MARK: - Actions

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        inputText = ""

        // Add user message
        let userMessage = Message(
            role: .user,
            content: text
        )
        messages.append(userMessage)

        sendQuery(userMessage: userMessage)
    }

    private func handleQuickHelp(_ button: QuickHelpButton) {
        let userMessage = Message(
            role: .user,
            content: button.visibleText
        )
        messages.append(userMessage)

        selectedCategoryId = button.category
        sendQuery(userMessage: userMessage, hiddenPrompt: button.hiddenPrompt)
    }

    private func sendQuery(userMessage: Message, hiddenPrompt: String? = nil) {
        guard let userId = authService.currentUser?.id else { return }

        isLoading = true

        Task {
            do {
                // Build messages for API
                var apiMessages = messages.map { Message(id: $0.id, role: $0.role, content: $0.content) }

                // If there's a hidden prompt, add it as a system message
                if let prompt = hiddenPrompt {
                    let systemMessage = Message(role: .system, content: prompt)
                    apiMessages.insert(systemMessage, at: 0)
                }

                let response = try await chatService.submitQuery(
                    sessionId: sessionId,
                    messages: apiMessages,
                    userId: userId,
                    categoryId: selectedCategoryId,
                    contextLabels: contextLabels,
                    language: i18n.currentLocale
                )

                // Add assistant response
                let assistantMessage = Message(
                    role: .assistant,
                    content: response.messageContent,
                    queryId: response.id,
                    metadata: MessageMetadata(sources: response.sources)
                )

                await MainActor.run {
                    messages.append(assistantMessage)
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    // Add error message
                    let errorMessage = Message(
                        role: .assistant,
                        content: i18n.translate("chatbot.processingError")
                    )
                    messages.append(errorMessage)
                }
            }
        }
    }

    private func submitFeedback(rating: Int, comment: String?, isPositive: Bool) {
        guard let message = selectedMessageForFeedback,
              let queryId = message.queryId,
              let userId = authService.currentUser?.id else { return }

        Task {
            do {
                try await chatService.submitFeedback(
                    queryId: queryId,
                    userId: userId,
                    rating: rating,
                    comment: comment,
                    isPositive: isPositive
                )

                await MainActor.run {
                    // Mark feedback as submitted
                    if let index = messages.firstIndex(where: { $0.id == message.id }) {
                        messages[index].feedbackSubmitted = true
                    }
                    showFeedbackSheet = false
                }
            } catch {
                print("[ChatView] Feedback error: \(error)")
            }
        }
    }

    private func handleAttachment() {
        // TODO: Implement file attachment
        print("Attachment tapped")
    }

    func startNewChat() {
        messages = []
        sessionId = UUID().uuidString
        selectedCategoryId = nil
        contextLabels = nil
    }

    func loadConversation(_ conversation: Conversation) {
        messages = conversation.messages ?? []
        sessionId = conversation.sessionId
    }
}

#Preview {
    ChatView()
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(I18nService())
}
