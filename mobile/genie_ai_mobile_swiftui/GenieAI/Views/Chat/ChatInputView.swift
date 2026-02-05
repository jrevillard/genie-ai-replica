// ChatInputView.swift
// Chat input field with send button and action toolbar

import SwiftUI

struct ChatInputView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @Binding var text: String
    var isLoading: Bool
    var onSend: () -> Void
    var onAttach: (() -> Void)?
    var onNewChat: (() -> Void)?
    var onSave: (() -> Void)?
    var onExportPDF: (() -> Void)?

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            // Action Buttons Toolbar
            HStack(spacing: 16) {
                if let onNewChat = onNewChat {
                    Button(action: onNewChat) {
                        SwiftUI.Label(i18n.translate("chatbot.newChat"), systemImage: "plus.circle")
                            .font(.caption)
                            .foregroundColor(isLoading ? .gray : theme.primaryColor)
                    }
                    .disabled(isLoading)
                }

                if let onSave = onSave {
                    Button(action: onSave) {
                        SwiftUI.Label(i18n.translate("chatbot.save"), systemImage: "square.and.arrow.down")
                            .font(.caption)
                            .foregroundColor(isLoading ? .gray : theme.primaryColor)
                    }
                    .disabled(isLoading)
                }

                if let onExportPDF = onExportPDF {
                    Button(action: onExportPDF) {
                        SwiftUI.Label(i18n.translate("chatbot.exportPDF"), systemImage: "doc.richtext")
                            .font(.caption)
                            .foregroundColor(isLoading ? .gray : theme.primaryColor)
                    }
                    .disabled(isLoading)
                }

                Spacer()
            }
            .padding(.horizontal)
            .padding(.top, 6)

            // Input Row
            HStack(spacing: 12) {
                // Attachment Button
                if let onAttach = onAttach {
                    Button(action: onAttach) {
                        Image(systemName: "paperclip")
                            .font(.title3)
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }

                // Text Input
                HStack {
                    TextField(i18n.translate("chatbot.placeholder"), text: $text, axis: .vertical)
                        .focused($isFocused)
                        .lineLimit(1...5)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                }
                .background(theme.secondarySurfaceColor)
                .cornerRadius(20)

                // Send Button
                Button(action: onSend) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(canSend ? AnyShapeStyle(theme.navbarGradient) : AnyShapeStyle(Color.gray))
                }
                .disabled(!canSend)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(theme.surfaceColor)
        }
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }
}

#Preview {
    VStack {
        Spacer()
        ChatInputView(
            text: .constant(""),
            isLoading: false,
            onSend: {},
            onAttach: {},
            onNewChat: {},
            onSave: {},
            onExportPDF: {}
        )
    }
    .environment(ThemeManager())
    .environment(I18nService())
}
