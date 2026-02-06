// FeedbackSheet.swift
// Feedback submission sheet for chat responses with star rating, thumbs, and skin tones

import SwiftUI

struct FeedbackSheet: View {
    @Environment(ThemeManager.self) private var theme

    let message: Message
    var onSubmit: (Int, String?, Bool) -> Void
    var onDismiss: () -> Void

    @State private var rating: Int? = nil
    @State private var thumbFeedback: String? = nil
    @State private var comment = ""
    @State private var isSubmitting = false
    @State private var selectedSkinTone: Color = Color(hex: "#FFDCAC")

    private let skinTones: [(hex: String, color: Color)] = [
        ("#FFDCAC", Color(hex: "#FFDCAC")),
        ("#F1C27D", Color(hex: "#F1C27D")),
        ("#E0AC69", Color(hex: "#E0AC69")),
        ("#C68642", Color(hex: "#C68642")),
        ("#8D5524", Color(hex: "#8D5524"))
    ]

    private let ratingLabels = [
        1: "Useless",
        2: "Slightly Helpful",
        3: "Moderately Helpful",
        4: "Very Helpful",
        5: "Life Changing"
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Title
                    Text("Help Us Improve")
                        .font(.title2)
                        .fontWeight(.bold)

                    // Description
                    Text("Your feedback will be used to better tune the chatbot and improve responses over time.")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)

                    // Response Preview
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Chatbot Response:")
                            .font(.caption)
                            .foregroundColor(theme.secondaryTextColor)

                        Text(message.content)
                            .font(.subheadline)
                            .lineLimit(3)
                            .padding()
                            .background(theme.secondarySurfaceColor)
                            .cornerRadius(8)
                    }
                    .padding(.horizontal)

                    // Thumbs Up/Down
                    VStack(spacing: 8) {
                        Text("Quick Feedback")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        HStack(spacing: 24) {
                            thumbButton(type: "up", icon: "hand.thumbsup.fill")
                            thumbButton(type: "down", icon: "hand.thumbsdown.fill")
                        }
                    }

                    // Star Rating
                    VStack(spacing: 8) {
                        HStack(spacing: 8) {
                            ForEach(1...5, id: \.self) { value in
                                Button(action: { rating = value }) {
                                    Image(systemName: value <= (rating ?? 0) ? "star.fill" : "star")
                                        .font(.title)
                                        .foregroundColor(value <= (rating ?? 0) ? .yellow : .gray)
                                }
                            }
                        }

                        if let currentRating = rating {
                            Text(ratingLabels[currentRating] ?? "")
                                .font(.subheadline)
                                .foregroundColor(theme.secondaryTextColor)
                        }
                    }

                    // Skin Tone Selector
                    VStack(spacing: 8) {
                        Text("Skin Tone")
                            .font(.caption)
                            .foregroundColor(theme.secondaryTextColor)

                        HStack(spacing: 12) {
                            ForEach(skinTones, id: \.hex) { tone in
                                Circle()
                                    .fill(tone.color)
                                    .frame(width: 32, height: 32)
                                    .overlay(
                                        Circle()
                                            .stroke(selectedSkinTone == tone.color ? theme.primaryColor : Color.clear, lineWidth: 2)
                                    )
                                    .shadow(color: selectedSkinTone == tone.color ? theme.primaryColor.opacity(0.4) : .clear, radius: 4)
                                    .onTapGesture {
                                        selectedSkinTone = tone.color
                                    }
                            }
                        }
                    }

                    // Comment Field
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Additional comments...", text: $comment, axis: .vertical)
                            .lineLimit(3...5)
                            .textFieldStyle(.plain)
                            .padding()
                            .background(theme.secondarySurfaceColor)
                            .cornerRadius(8)
                    }
                    .padding(.horizontal)

                    // Buttons
                    HStack(spacing: 16) {
                        Button(action: onDismiss) {
                            Text("Cancel")
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.gray.opacity(0.2))
                                .foregroundColor(theme.primaryTextColor)
                                .cornerRadius(12)
                        }

                        Button(action: submit) {
                            HStack {
                                if isSubmitting {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                }
                                Text("Submit")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(canSubmit ? theme.primaryColor : Color.gray)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(!canSubmit || isSubmitting)
                    }
                    .padding(.horizontal)
                    .padding(.bottom)
                }
                .padding(.top)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func thumbButton(type: String, icon: String) -> some View {
        Button {
            thumbFeedback = thumbFeedback == type ? nil : type
            // Auto-set rating based on thumb feedback
            if thumbFeedback == "up" {
                rating = 4
            } else if thumbFeedback == "down" {
                rating = 2
            }
        } label: {
            Image(systemName: icon)
                .font(.title)
                .foregroundColor(thumbFeedback == type ? theme.primaryColor : .gray)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(thumbFeedback == type ? theme.primaryColor : Color.gray.opacity(0.3), lineWidth: 2)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(thumbFeedback == type ? theme.primaryColor.opacity(0.1) : Color.clear)
                        )
                )
        }
    }

    private var canSubmit: Bool {
        rating != nil || thumbFeedback != nil
    }

    private func submit() {
        isSubmitting = true
        let finalRating = rating ?? (thumbFeedback == "up" ? 4 : thumbFeedback == "down" ? 2 : 3)
        let isPositive = thumbFeedback == "up" || finalRating >= 4
        onSubmit(finalRating, comment.isEmpty ? nil : comment, isPositive)
    }
}

#Preview {
    FeedbackSheet(
        message: Message(
            role: .assistant,
            content: "To apply for a national ID, you need to visit the Huduma Centre with your birth certificate."
        ),
        onSubmit: { _, _, _ in },
        onDismiss: {}
    )
    .environment(ThemeManager())
}
