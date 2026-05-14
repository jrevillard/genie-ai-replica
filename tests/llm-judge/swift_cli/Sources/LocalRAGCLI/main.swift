// LocalRAGCLI — runs the iOS LocalRAG pipeline from the macOS command
// line so the LLM-as-a-judge test harness can evaluate on-device
// behaviour without spinning up the simulator.
//
// Input (JSON on stdin):
//   {
//     "model_path": "/abs/path/to/gemma-2-2b-it-Q4_K_M.gguf",
//     "corpus_dir": "/abs/path/to/corpus/",
//     "queries": [
//       { "id": "tobacco-quit-basic",
//         "question": "How can I quit smoking?",
//         "labels": ["Tobacco Cessation"] },
//       ...
//     ]
//   }
//
// Output (JSON on stdout):
//   {
//     "results": [
//       { "id": "...",
//         "answer": "...",
//         "retrieved_context": "[1] From \"who-...\" (relevance: 37%):\n...",
//         "source_count": 1,
//         "duration_sec": 12.3 }
//     ]
//   }
//
// The retrieval/generation settings here MUST match LocalRAGBridge.swift
// in the iOS app — otherwise the test grades a different pipeline than
// the one users see. The system prompt is inlined verbatim from the
// bridge for that reason.

import Foundation
import LocalRAG

// MARK: - Settings mirrored from mobile LocalRAGBridge

// Generation
let kTemperature: Float = 0.2
// Retrieval
let kTopK: Int = 8
let kSimilarityThreshold: Double = 0.05
// Chunking
let kChunkSize: Int = 1200
let kChunkOverlap: Int = 200
// History windowing — for the CLI we don't pass conversation history at
// all, so this is mostly informational. Mobile uses 1 (the latest user
// message only) for the same reason: putting the chunks and the question
// in the same user turn helps small models ground.

// The system prompt template — must be kept in sync with
// genie_ai_mobile_swiftui/GenieAI/Services/LocalRAGBridge.swift. Treat any
// drift between the two as a test-harness bug.
let kSystemPromptTemplate: String = """
You are a friendly and polite information assistant.

Your task is to answer the user's latest question using ONLY the knowledge base content below. Treat the knowledge base as the single source of truth — your own prior knowledge is irrelevant.

**How to read the knowledge base:**
- The knowledge base contains numbered chunks like `[1] From "<filename.pdf>" (relevance: X%):`. The `[1]`, `[2]` etc. are just chunk indices, NOT citations. The filename inside the quotes after `From` is the citation title.
- Synthesize an answer from whichever chunks discuss the topic of the question. The chunks won't always be phrased as a step-by-step answer — extract the relevant facts (treatments, definitions, recommendations, procedures) and present them clearly.
- Abstain ONLY when none of the chunks discuss the topic of the question at all. In that case reply with one short sentence saying the offline library does not cover this question, and write `Sources:` with nothing after it.

**Grounding rules:**
- Do NOT invent or extrapolate. Every concrete fact in your answer (names, codes, URLs, phone numbers, dates, prices, statistics, organisation names) MUST appear verbatim in one of the chunks. If you cannot point to a chunk for a fact, do not state that fact.
- Cite every fact-bearing statement inline with [Source: <exact filename>] immediately after the statement. Copy the filename verbatim from `From "<filename>"`. Never write `[Source: [1]]`, `[1]`, `[Source: chunk 1]` or abbreviated titles.
- End your reply with a single line `Sources: <comma-separated list of filenames you cited>`. Use the exact filenames. No square brackets, no chunk numbers, no duplicates.

**Example (a question about smoking cessation, citing a real filename):**
```
Nicotine replacement therapy products include nicotine gum, patches, lozenges, inhalers, and nasal or mouth sprays [Source: who-treatment-guidelines-tobacco-use.pdf]. Varenicline, NRT, or bupropion are recommended as first-line treatment options [Source: who-treatment-guidelines-tobacco-use.pdf].
Sources: who-treatment-guidelines-tobacco-use.pdf
```

**Style rules:**
- Reply directly as a chat message. No "Dear …" / "Hello <Name>," opener; no "Best regards", "Sincerely", or "[Your Assistant]" signoff.
- Write in a warm, friendly, conversational tone — like a knowledgeable friend explaining things. Address the reader as "you" where natural. Don't read like an encyclopedia entry: lead with the most useful information first, then explain the options.
- Use a couple of short paragraphs or a brief bulleted list when there are multiple options. Don't pad with disclaimers, but a one-line closing encouragement is welcome ("Talk to a healthcare provider to figure out what's right for you," etc.) as long as it doesn't introduce facts the chunks don't support.

Knowledge base content:
{context}
"""

// MARK: - IO types

struct QueryInput: Decodable {
    let id: String
    let question: String
    let labels: [String]?
}

struct CLIInput: Decodable {
    let model_path: String
    let corpus_dir: String
    let queries: [QueryInput]
}

struct QueryResult: Encodable {
    let id: String
    let answer: String
    let retrieved_context: String
    let source_count: Int
    let duration_sec: Double
}

struct CLIOutput: Encodable {
    let results: [QueryResult]
}

// MARK: - Helpers

func die(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func writeStdoutJSON<T: Encodable>(_ value: T) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    do {
        let data = try enc.encode(value)
        FileHandle.standardOutput.write(data)
    } catch {
        die("Failed to encode JSON output: \(error)")
    }
}

/// Read every .txt / .md file in `dir` and return (filename, content).
/// We use the filename as the document title — the test cases reference
/// titles like `who-treatment-guidelines-tobacco-use.pdf` (yes including
/// the .pdf extension, because that's how the user's mobile library
/// names the indexed document).
func loadCorpus(_ dirURL: URL) throws -> [(title: String, content: String)] {
    let fm = FileManager.default
    let allowed: Set<String> = ["txt", "md"]
    let items = try fm.contentsOfDirectory(at: dirURL, includingPropertiesForKeys: nil)
    let docs: [(String, String)] = try items.compactMap { url in
        guard allowed.contains(url.pathExtension.lowercased()) else { return nil }
        let content = try String(contentsOf: url, encoding: .utf8)
        // Strip the .txt/.md extension and append .pdf to match how the
        // mobile app titles indexed documents — the system prompt's
        // citation rule expects filenames that include the .pdf suffix.
        // If the corpus file is already named with .pdf in the stem
        // (e.g. who-treatment-guidelines-tobacco-use.pdf.txt) we use the
        // stem as-is.
        let stem = url.deletingPathExtension().lastPathComponent
        let title = stem.lowercased().hasSuffix(".pdf") ? stem : "\(stem).pdf"
        return (title, content)
    }
    if docs.isEmpty {
        throw NSError(
            domain: "LocalRAGCLI",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "No .txt/.md files in corpus dir \(dirURL.path)"]
        )
    }
    return docs
}

// MARK: - Main

@main
struct LocalRAGCLI {
    static func main() async {
        // 1. Read stdin JSON
        let stdinData = FileHandle.standardInput.readDataToEndOfFile()
        let input: CLIInput
        do {
            input = try JSONDecoder().decode(CLIInput.self, from: stdinData)
        } catch {
            die("Failed to parse stdin JSON: \(error)")
        }

        // 2. Set up LocalRAGService with the same config the mobile bridge uses
        let modelURL = URL(fileURLWithPath: input.model_path)
        guard FileManager.default.fileExists(atPath: modelURL.path) else {
            die("Model file not found at \(modelURL.path)")
        }
        let corpusURL = URL(fileURLWithPath: input.corpus_dir)

        let config = RAGConfiguration(
            topK: kTopK,
            chunkSize: kChunkSize,
            chunkOverlap: kChunkOverlap,
            similarityThreshold: kSimilarityThreshold,
            provider: .llamaCpp(modelPath: modelURL.path),
            systemPromptTemplate: kSystemPromptTemplate,
            temperature: kTemperature
        )
        let service = LocalRAGService(config: config)

        FileHandle.standardError.write(Data("[CLI] Loading model: \(modelURL.path)\n".utf8))
        do {
            try await service.loadModel()
        } catch {
            die("Failed to load LocalRAG model: \(error)")
        }

        // 3. Index the corpus
        FileHandle.standardError.write(Data("[CLI] Indexing corpus: \(corpusURL.path)\n".utf8))
        let docs: [(String, String)]
        do {
            docs = try loadCorpus(corpusURL)
        } catch {
            die("Failed to load corpus: \(error)")
        }
        for (title, content) in docs {
            do {
                let doc = RAGDocument(title: title, content: content)
                try await service.indexDocument(doc)
                FileHandle.standardError.write(Data("[CLI]   indexed \(title) (\(content.count) chars)\n".utf8))
            } catch {
                die("Failed to index \(title): \(error)")
            }
        }

        // 4. Run queries
        var results: [QueryResult] = []
        for q in input.queries {
            FileHandle.standardError.write(Data("[CLI] Querying \(q.id): \(q.question)\n".utf8))
            let clock = ContinuousClock()
            let t0 = clock.now

            let ragQuery = RAGQuery(
                text: q.question,
                conversationHistory: [],
                categoryLabels: q.labels ?? []
            )

            do {
                let response = try await service.query(ragQuery)
                let elapsed = clock.now - t0
                let elapsedSec = Double(elapsed.components.seconds)
                    + Double(elapsed.components.attoseconds) / 1e18

                // Dedup chunk-level sources to one entry per document title,
                // mirroring LocalRAGBridge.ragResponseToQueryResponse so the
                // CLI's source_count is comparable to what the iOS app
                // would surface to the user.
                var seenTitles = Set<String>()
                let deduped = response.sources
                    .sorted { $0.score > $1.score }
                    .filter { seenTitles.insert($0.title).inserted }

                // Re-render the retrieved chunks in the format used by
                // LocalRAG's ContextFormatter — that's what the judge
                // expects as "retrieved_context".
                let contextLines: [String] = response.sources.enumerated().map { (i, src) in
                    let pct = Int((src.score * 100).rounded())
                    let snippet = src.snippet.trimmingCharacters(in: .whitespacesAndNewlines)
                    return "[\(i + 1)] From \"\(src.title)\" (relevance: \(pct)%):\n\(snippet)"
                }
                let retrievedContext = contextLines.joined(separator: "\n\n")

                results.append(
                    QueryResult(
                        id: q.id,
                        answer: response.content,
                        retrieved_context: retrievedContext,
                        source_count: deduped.count,
                        duration_sec: elapsedSec
                    )
                )
            } catch {
                results.append(
                    QueryResult(
                        id: q.id,
                        answer: "[ERROR] \(error)",
                        retrieved_context: "",
                        source_count: 0,
                        duration_sec: 0
                    )
                )
            }
        }

        writeStdoutJSON(CLIOutput(results: results))
    }
}
