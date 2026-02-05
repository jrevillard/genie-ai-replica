// FeedbackSheet.swift
// Feedback submission sheet for chat responses

import SwiftUI

struct FeedbackSheet: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let message: Message
    var onSubmit: (Int, String?, Bool) -> Void
    var onDismiss: () -> Void

    @State private var rating: Int = 3
    @State private var comment = ""
    @State private var isSubmitting = false

    private let ratingLabels = [
        1: "Useless",
        2: "Slightly Helpful",
        3: "Moderately Helpful",
        4: "Very Helpful",
        5: "Life Changing"
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Title
                Text(i18n.translate("responseRating.title"))
                    .font(.title2)
                    .fontWeight(.bold)

                // Description
                Text(i18n.translate("responseRating.note"))
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                // Response Preview
                VStack(alignment: .leading, spacing: 8) {
                    Text(i18n.translate("responseRating.chatbotResponse"))
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

                // Rating Stars
                VStack(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(1...5, id: \.self) { value in
                            Button(action: { rating = value }) {
                                Image(systemName: value <= rating ? "star.fill" : "star")
                                    .font(.title)
                                    .foregroundColor(value <= rating ? .yellow : .gray)
                            }
                        }
                    }

                    Text(ratingLabels[rating] ?? "")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)
                }

                // Comment Field
                VStack(alignment: .leading, spacing: 8) {
                    TextField(i18n.translate("responseRating.additionalComments"), text: $comment, axis: .vertical)
                        .lineLimit(3...5)
                        .textFieldStyle(.plain)
                        .padding()
                        .background(theme.secondarySurfaceColor)
                        .cornerRadius(8)
                }
                .padding(.horizontal)

                Spacer()

                // Buttons
                HStack(spacing: 16) {
                    Button(action: onDismiss) {
                        Text(i18n.translate("responseRating.cancel"))
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
                            Text(i18n.translate("responseRating.submit"))
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(theme.primaryColor)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(isSubmitting)
                }
                .padding(.horizontal)
                .padding(.bottom)
            }
            .padding(.top)
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

    private func submit() {
        isSubmitting = true
        let isPositive = rating >= 4
        onSubmit(rating, comment.isEmpty ? nil : comment, isPositive)
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
    .environment(I18nService())
}
