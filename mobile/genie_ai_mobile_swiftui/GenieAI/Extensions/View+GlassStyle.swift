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

    /// Staggered entrance animation: slide + scale, delayed by index.
    /// Items are always rendered at full opacity — the entrance polish is
    /// achieved via the offset/scale spring only. The previous version gated
    /// opacity on `index < visibleCount` so items stayed invisible until
    /// `visibleCount` was bumped via `onAppear`/`onChange`; that gate was
    /// brittle (offline RAG could populate `relatedDocs` before/after the
    /// sidebar's `onAppear` fired) and could leave correct data at opacity 0.
    /// Visibility is now unconditional; only the entrance motion respects
    /// `visibleCount`.
    func staggeredAppearance(index: Int, visibleCount: Int, theme: ThemeManager) -> some View {
        self
            .offset(y: index < visibleCount ? 0 : 12)
            .scaleEffect(index < visibleCount ? 1 : 0.95)
            .animation(
                theme.animationsEnabled
                    ? .spring(response: 0.4, dampingFraction: 0.75).delay(0.2 + Double(index) * 0.06)
                    : nil,
                value: visibleCount
            )
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

// MARK: - Category Color Palette

/// Light pastel palette for category badges, conversation accents, and visual variety.
/// Deterministic: the same name always maps to the same color.
/// Colors are bright and airy — candy pastels with minimal earthiness.
enum CategoryPalette {
    static let colors: [Color] = [
        Color(red: 0.58, green: 0.84, blue: 0.86), // Aqua
        Color(red: 0.70, green: 0.86, blue: 0.60), // Mint
        Color(red: 0.95, green: 0.65, blue: 0.62), // Peach
        Color(red: 0.80, green: 0.68, blue: 0.92), // Lavender
        Color(red: 0.65, green: 0.80, blue: 0.95), // Periwinkle
        Color(red: 0.98, green: 0.88, blue: 0.50), // Sunshine
        Color(red: 0.93, green: 0.62, blue: 0.72), // Pink
        Color(red: 0.73, green: 0.70, blue: 0.92), // Wisteria
        Color(red: 0.78, green: 0.88, blue: 0.60), // Lime
        Color(red: 0.92, green: 0.75, blue: 0.62), // Apricot
        Color(red: 0.95, green: 0.78, blue: 0.55), // Tangerine
        Color(red: 0.55, green: 0.85, blue: 0.80), // Seafoam
    ]

    /// Returns a deterministic color for a given string (e.g., category name, conversation title).
    static func color(for name: String) -> Color {
        let hash = abs(name.hashValue)
        return colors[hash % colors.count]
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
