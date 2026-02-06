// ChatInputView.swift
// Chat input field with send button and action toolbar

import SwiftUI

struct ChatInputView: View {
    @Environment(ThemeManager.self) private var theme

    @Binding var text: String
    var isLoading: Bool
    var onSend: () -> Void
    var onNewChat: (() -> Void)?
    var onSave: (() -> Void)?
    var onExportPDF: (() -> Void)?
    var onShareWhatsApp: (() -> Void)?

    @FocusState private var isFocused: Bool
    @State private var sendScale: CGFloat = 1.0

    var body: some View {
        VStack(spacing: 0) {
            // Action Buttons Toolbar
            HStack(spacing: 16) {
                if let onNewChat = onNewChat {
                    Button(action: onNewChat) {
                        SwiftUI.Label("New Chat", systemImage: "plus.circle")
                            .font(.caption)
                            .foregroundColor(isLoading ? .gray : theme.primaryColor)
                    }
                    .disabled(isLoading)
                    .hapticOnTap(theme: theme)
                }

                if let onSave = onSave {
                    Button(action: onSave) {
                        SwiftUI.Label("Save Chat", systemImage: "square.and.arrow.down")
                            .font(.caption)
                            .foregroundColor(isLoading ? .gray : theme.primaryColor)
                    }
                    .disabled(isLoading)
                    .hapticOnTap(theme: theme)
                }

                if let onExportPDF = onExportPDF {
                    Button(action: onExportPDF) {
                        SwiftUI.Label("Export Chat to PDF", systemImage: "doc.richtext")
                            .font(.caption)
                            .foregroundColor(isLoading ? .gray : theme.primaryColor)
                    }
                    .disabled(isLoading)
                    .hapticOnTap(theme: theme)
                }

                if let onShareWhatsApp = onShareWhatsApp {
                    Button(action: onShareWhatsApp) {
                        SwiftUI.Label("Share on WhatsApp", systemImage: "bubble.left.fill")
                            .font(.caption)
                            .foregroundColor(isLoading ? .gray : theme.whatsAppGreen)
                    }
                    .disabled(isLoading)
                    .hapticOnTap(theme: theme)
                }

                Spacer()
            }
            .padding(.horizontal)
            .padding(.top, 6)

            // Input Row
            HStack(spacing: 12) {
                // Text Input
                HStack {
                    TextField("Type your query here...", text: $text, axis: .vertical)
                        .focused($isFocused)
                        .lineLimit(1...5)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                }
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(theme.glassBorder, lineWidth: 1)
                )

                // Send Button
                Button(action: {
                    withAnimation(theme.animationQuick) {
                        sendScale = 0.85
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        withAnimation(theme.animationBounce) {
                            sendScale = 1.0
                        }
                    }
                    onSend()
                }) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(canSend ? AnyShapeStyle(theme.navbarGradient) : AnyShapeStyle(Color.gray))
                        .scaleEffect(sendScale)
                }
                .disabled(!canSend)
                .hapticOnTap(.medium, theme: theme)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
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
            onNewChat: {},
            onSave: {},
            onExportPDF: {},
            onShareWhatsApp: {}
        )
    }
    .environment(ThemeManager())
}
