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
    @State private var showActions = false

    private let sendSize: CGFloat = 44
    private let plusSize: CGFloat = 35
    private let fillColor = Color.gray.opacity(0.15)

    private var hasActions: Bool {
        onNewChat != nil || onSave != nil || onExportPDF != nil || onShareWhatsApp != nil
    }

    var body: some View {
        if #available(iOS 26, *) {
            GlassEffectContainer {
                inputBar
            }
        } else {
            inputBar
        }
    }

    // MARK: - Input Bar

    @ViewBuilder
    private var inputBar: some View {
        VStack(spacing: 8) {
            // Expandable action row
            if showActions {
                actionRow
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            // Main input row
            HStack(alignment: .bottom, spacing: 10) {
                mainBar
                sendButton
            }
        }
        .padding(.horizontal, 15)
        .padding(.bottom, 10)
        .animation(.easeOut(duration: 0.2), value: showActions)
    }

    // MARK: - Action Row

    @ViewBuilder
    private var actionRow: some View {
        HStack(spacing: 12) {
            if let onNewChat = onNewChat {
                actionButton("New Chat", icon: "plus.message") {
                    onNewChat()
                }
            }
            if let onSave = onSave {
                actionButton("Save Chat", icon: "square.and.arrow.down") {
                    onSave()
                }
            }
            if let onExportPDF = onExportPDF {
                actionButton("Export PDF", icon: "doc.richtext") {
                    onExportPDF()
                }
            }
            if let onShareWhatsApp = onShareWhatsApp {
                actionButton("Share on WhatsApp", icon: "square.and.arrow.up", tint: theme.whatsAppGreen) {
                    onShareWhatsApp()
                }
            }
            Spacer()
        }
    }

    @ViewBuilder
    private func actionButton(_ accessibilityLabel: String, icon: String, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button {
            action()
            withAnimation(.easeOut(duration: 0.2)) {
                showActions = false
            }
        } label: {
            Image(systemName: icon)
                .font(.body.weight(.medium))
                .foregroundStyle(tint ?? Color.primary)
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel(accessibilityLabel)
        .disabled(isLoading)
        .modifier(ActionButtonStyle(fillColor: fillColor))
        .hapticOnTap(theme: theme)
    }

    // MARK: - Send Button

    @ViewBuilder
    private var sendButton: some View {
        if #available(iOS 26, *) {
            Button(action: onSend) {
                sendButtonIcon
            }
            .glassEffect(
                canSend
                    ? .regular.interactive().tint(theme.primaryColor)
                    : .regular.interactive(),
                in: .circle
            )
            .disabled(!canSend)
            .hapticOnTap(.medium, theme: theme)
        } else {
            Button(action: onSend) {
                sendButtonIcon
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
    }

    @ViewBuilder
    private var sendButtonIcon: some View {
        Image(systemName: "paperplane.fill")
            .font(.body.weight(.medium))
            .foregroundStyle(canSend ? Color.white : Color.primary)
            .frame(width: sendSize, height: sendSize)
    }

    // MARK: - Main Bar

    @ViewBuilder
    private var mainBar: some View {
        let cornerRadius: CGFloat = isFocused ? 25 : 30
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        if #available(iOS 26, *) {
            mainBarContent
                .glassEffect(.regular, in: shape)
                .animation(.easeOut(duration: 0.25), value: isFocused)
        } else {
            mainBarContent
                .background(.ultraThinMaterial, in: shape)
                .shadow(color: .black.opacity(0.1), radius: 5, x: 0, y: 5)
                .shadow(color: .black.opacity(0.08), radius: 15, x: 0, y: -5)
                .animation(.easeOut(duration: 0.25), value: isFocused)
        }
    }

    @ViewBuilder
    private var mainBarContent: some View {
        HStack(alignment: .bottom, spacing: 0) {
            // Plus toggle button
            if hasActions {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) {
                        showActions.toggle()
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.primary)
                        .frame(width: plusSize, height: plusSize)
                        .background(showActions ? Color.gray.opacity(0.25) : fillColor, in: .circle)
                        .contentShape(.circle)
                        .rotationEffect(.degrees(showActions ? 45 : 0))
                }
                .hapticOnTap(theme: theme)
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
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }
}

// MARK: - Action Button Style

private struct ActionButtonStyle: ViewModifier {
    let fillColor: Color

    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content
                .glassEffect(.regular.interactive(), in: .capsule)
        } else {
            content
                .background(.ultraThinMaterial, in: .capsule)
                .shadow(color: .black.opacity(0.08), radius: 4, x: 0, y: 2)
        }
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
