// ChatInputView.swift
// Floating translucent chat input bar with plus menu and send button

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

    private let sendSize: CGFloat = 44
    private let plusSize: CGFloat = 35
    private let fillColor = Color.gray.opacity(0.15)

    private var hasActions: Bool {
        onNewChat != nil || onSave != nil || onExportPDF != nil || onShareWhatsApp != nil
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Main bar (plus button + text field)
            mainBar

            // Send button — floating circle
            Button(action: onSend) {
                Image(systemName: "paperplane.fill")
                    .font(.body.weight(.medium))
                    .foregroundStyle(canSend ? Color.white : Color.primary)
                    .frame(width: sendSize, height: sendSize)
                    .background {
                        Circle()
                            .fill(canSend ? AnyShapeStyle(theme.primaryColor.gradient) : AnyShapeStyle(fillColor))
                    }
            }
            .clipShape(.circle)
            .shadow(color: .black.opacity(0.1), radius: 5, x: 0, y: 5)
            .shadow(color: .black.opacity(0.08), radius: 15, x: 0, y: -5)
            .disabled(!canSend)
            .hapticOnTap(.medium, theme: theme)
        }
        .padding(.horizontal, 15)
        .padding(.bottom, 10)
    }

    // MARK: - Main Bar

    @ViewBuilder
    private var mainBar: some View {
        let cornerRadius: CGFloat = isFocused ? 25 : 30

        HStack(alignment: .bottom, spacing: 0) {
            // Plus menu button
            if hasActions {
                actionsMenu
                    .padding(.leading, 8)
                    .padding(.bottom, 8)
            }

            // Text field
            TextField("Type your query here...", text: $text, axis: .vertical)
                .lineLimit(isFocused ? 5 : 1)
                .focused($isFocused)
                .padding(.leading, hasActions ? 8 : 15)
                .padding(.trailing, 15)
                .padding(.vertical, 14)
        }
        .background(
            .ultraThinMaterial,
            in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        )
        .shadow(color: .black.opacity(0.1), radius: 5, x: 0, y: 5)
        .shadow(color: .black.opacity(0.08), radius: 15, x: 0, y: -5)
        .animation(.easeOut(duration: 0.25), value: isFocused)
    }

    // MARK: - Actions Menu

    @ViewBuilder
    private var actionsMenu: some View {
        Menu {
            if let onNewChat = onNewChat {
                Button(action: onNewChat) {
                    SwiftUI.Label("New Chat", systemImage: "plus.message")
                }
                .disabled(isLoading)
            }

            if let onSave = onSave {
                Button(action: onSave) {
                    SwiftUI.Label("Save Chat", systemImage: "square.and.arrow.down")
                }
                .disabled(isLoading)
            }

            if let onExportPDF = onExportPDF {
                Button(action: onExportPDF) {
                    SwiftUI.Label("Export PDF", systemImage: "doc.richtext")
                }
                .disabled(isLoading)
            }

            if let onShareWhatsApp = onShareWhatsApp {
                Button(action: onShareWhatsApp) {
                    SwiftUI.Label("Share on WhatsApp", systemImage: "square.and.arrow.up")
                }
                .disabled(isLoading)
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Color.primary)
                .frame(width: plusSize, height: plusSize)
                .background(fillColor, in: .circle)
                .contentShape(.circle)
        }
        .hapticOnTap(theme: theme)
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }
}

#Preview {
    ZStack {
        LinearGradient(colors: [.blue, .purple], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
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
    }
    .environment(ThemeManager())
}
