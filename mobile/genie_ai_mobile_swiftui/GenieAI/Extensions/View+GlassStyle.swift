// View+GlassStyle.swift
// Glass card and haptic view modifiers for Liquid Glass design system

import SwiftUI

// MARK: - Glass Card Modifiers

extension View {
    /// Standard glass card: thin material + continuous corners + border + soft shadow
    func glassCard(theme: ThemeManager, radius: CGFloat? = nil) -> some View {
        let r = radius ?? theme.radiusLG
        return self
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: r, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: r, style: .continuous)
                    .stroke(theme.glassBorder, lineWidth: 1)
            )
            .shadow(
                color: theme.shadowSoft.color,
                radius: theme.shadowSoft.radius,
                x: theme.shadowSoft.x,
                y: theme.shadowSoft.y
            )
    }

    /// Elevated glass card: regular material + larger radius + medium shadow
    func glassCardElevated(theme: ThemeManager) -> some View {
        self
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: theme.radiusXL, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusXL, style: .continuous)
                    .stroke(theme.glassBorder, lineWidth: 1)
            )
            .shadow(
                color: theme.shadowMedium.color,
                radius: theme.shadowMedium.radius,
                x: theme.shadowMedium.x,
                y: theme.shadowMedium.y
            )
    }

    /// Adds haptic feedback on tap (reads theme.hapticsEnabled)
    func hapticOnTap(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light, theme: ThemeManager) -> some View {
        self.simultaneousGesture(
            TapGesture().onEnded {
                guard theme.hapticsEnabled else { return }
                UIImpactFeedbackGenerator(style: style).impactOccurred()
            }
        )
    }

    /// Applies a shadow from a ThemeManager.ShadowStyle
    func shadow(_ style: ThemeManager.ShadowStyle) -> some View {
        self.shadow(color: style.color, radius: style.radius, x: style.x, y: style.y)
    }
}

// MARK: - Glass Press Button Style

/// Button style with scale-down press effect and optional haptic feedback
struct GlassPressButtonStyle: ButtonStyle {
    let hapticsEnabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1.0)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, isPressed in
                if isPressed && hapticsEnabled {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            }
    }
}

// MARK: - Bouncing Dots Typing Indicator

struct BouncingDotsView: View {
    let color: Color
    @State private var animating = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                    .offset(y: animating ? -6 : 0)
                    .animation(
                        .easeInOut(duration: 0.4)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.15),
                        value: animating
                    )
            }
        }
        .onAppear { animating = true }
    }
}
