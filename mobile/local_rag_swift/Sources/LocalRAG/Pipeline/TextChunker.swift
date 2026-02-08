// TextChunker.swift
// Splits text into overlapping chunks at sentence boundaries

import Foundation
import NaturalLanguage

public struct TextChunker: Sendable {
    public let chunkSize: Int
    public let overlap: Int

    public init(chunkSize: Int = 500, overlap: Int = 50) {
        self.chunkSize = chunkSize
        self.overlap = overlap
    }

    /// Split text into overlapping chunks using sentence boundaries
    public func chunk(_ text: String) -> [String] {
        let sentences = splitSentences(text)
        guard !sentences.isEmpty else { return [] }

        var chunks: [String] = []
        var currentChunk = ""
        var sentenceBuffer: [String] = []

        for sentence in sentences {
            let candidate = currentChunk.isEmpty ? sentence : currentChunk + " " + sentence

            if candidate.count > chunkSize && !currentChunk.isEmpty {
                chunks.append(currentChunk.trimmingCharacters(in: .whitespacesAndNewlines))

                // Build overlap from recent sentences
                let overlapText = buildOverlap(from: sentenceBuffer)
                currentChunk = overlapText.isEmpty ? sentence : overlapText + " " + sentence
                sentenceBuffer = overlapText.isEmpty ? [] : [overlapText]
            } else {
                currentChunk = candidate
            }

            sentenceBuffer.append(sentence)
        }

        // Add the last chunk
        if !currentChunk.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            chunks.append(currentChunk.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        return chunks
    }

    // MARK: - Private

    private func splitSentences(_ text: String) -> [String] {
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text

        var sentences: [String] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            let sentence = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !sentence.isEmpty {
                sentences.append(sentence)
            }
            return true
        }

        // Fallback if NLTokenizer returns nothing
        if sentences.isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            sentences = [text.trimmingCharacters(in: .whitespacesAndNewlines)]
        }

        return sentences
    }

    private func buildOverlap(from sentences: [String]) -> String {
        guard overlap > 0 else { return "" }

        var overlapText = ""
        // Walk backwards through sentences until we hit the overlap size
        for sentence in sentences.reversed() {
            let candidate = overlapText.isEmpty ? sentence : sentence + " " + overlapText
            if candidate.count > overlap {
                break
            }
            overlapText = candidate
        }
        return overlapText
    }
}
