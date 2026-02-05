// ChatInputView.swift
// Chat input field with send button

import SwiftUI

struct ChatInputView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @Binding var text: String
    var isLoading: Bool
    var onSend: () -> Void
    var onAttach: (() -> Void)?

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Divider()

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
            onAttach: {}
        )
    }
    .environment(ThemeManager())
    .environment(I18nService())
}
