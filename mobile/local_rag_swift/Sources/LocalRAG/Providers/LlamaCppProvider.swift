// LlamaCppProvider.swift
// LLM provider wrapping the llama.cpp C API

import Foundation
import llama
import os

public actor LlamaCppProvider: LLMProvider {
    private let modelPath: String
    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private static let logger = Logger(subsystem: "com.genieai", category: "llm.local.llamacpp")

    public init(modelPath: String) {
        self.modelPath = modelPath
    }

    public var isReady: Bool {
        model != nil && context != nil
    }

    public func loadModel() async throws {
        guard !isReady else { return }

        Self.logger.info("Loading llama.cpp model: path=\(self.modelPath, privacy: .private)")
        let clock = ContinuousClock()
        let startTime = clock.now

        llama_backend_init()

        // Load model
        var modelParams = llama_model_default_params()
        modelParams.n_gpu_layers = 99 // Offload all layers to Metal

        guard let loadedModel = llama_load_model_from_file(modelPath, modelParams) else {
            Self.logger.error("Failed to load model from path=\(self.modelPath, privacy: .private)")
            throw LocalRAGError.modelLoadFailed("Failed to load model from \(modelPath)")
        }
        self.model = loadedModel

        // Create context
        var contextParams = llama_context_default_params()
        contextParams.n_ctx = 4096
        contextParams.n_batch = 512

        guard let ctx = llama_new_context_with_model(loadedModel, contextParams) else {
            llama_free_model(loadedModel)
            self.model = nil
            Self.logger.error("Failed to create llama.cpp context")
            throw LocalRAGError.modelLoadFailed("Failed to create context")
        }
        self.context = ctx

        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("llama.cpp model loaded: n_ctx=4096, n_batch=512, duration=\(durationMs)ms")
    }

    public func unloadModel() async {
        Self.logger.info("Unloading llama.cpp model")
        if let ctx = context {
            llama_free(ctx)
            self.context = nil
        }
        if let mdl = model {
            llama_free_model(mdl)
            self.model = nil
        }
        llama_backend_free()
    }

    public func generate(
        systemPrompt: String,
        messages: [LLMMessage],
        context contextText: String,
        config: LLMGenerationConfig
    ) async throws -> String {
        guard let model, let context else {
            throw LocalRAGError.modelNotLoaded
        }

        Self.logger.info("llama.cpp generate: systemPromptLength=\(systemPrompt.count), messages=\(messages.count), contextLength=\(contextText.count), maxTokens=\(config.maxTokens), temperature=\(config.temperature, format: .fixed(precision: 2)), topK=\(config.topK), topP=\(config.topP, format: .fixed(precision: 2))")
        Self.logger.debug("llama.cpp system prompt: \(systemPrompt)")

        let clock = ContinuousClock()
        let startTime = clock.now

        // Build chat prompt in Gemma/ChatML format
        let prompt = buildPrompt(systemPrompt: systemPrompt, messages: messages, context: contextText)
        Self.logger.debug("llama.cpp full prompt: \(prompt)")

        // Tokenize
        let promptTokens = tokenize(prompt, model: model)
        guard !promptTokens.isEmpty else {
            Self.logger.error("Failed to tokenize prompt (length=\(prompt.count))")
            throw LocalRAGError.generationFailed("Failed to tokenize prompt")
        }

        Self.logger.info("Tokenized prompt: promptTokens=\(promptTokens.count)")

        // Clear KV cache
        llama_kv_cache_clear(context)

        // Decode prompt tokens in batches
        let batchSize = 512
        for i in stride(from: 0, to: promptTokens.count, by: batchSize) {
            let end = min(i + batchSize, promptTokens.count)
            let batchTokens = Array(promptTokens[i..<end])

            var batch = llama_batch_init(Int32(batchTokens.count), 0, 1)
            defer { llama_batch_free(batch) }

            for (j, token) in batchTokens.enumerated() {
                let pos = Int32(i + j)
                let isLast = (i + j == promptTokens.count - 1)
                batch.token[j] = token
                batch.pos[j] = pos
                batch.n_seq_id[j] = 1
                batch.seq_id[j]![0] = 0
                batch.logits[j] = isLast ? 1 : 0
            }
            batch.n_tokens = Int32(batchTokens.count)

            let status = llama_decode(context, batch)
            guard status == 0 else {
                Self.logger.error("llama_decode failed: status=\(status)")
                throw LocalRAGError.generationFailed("llama_decode failed with status \(status)")
            }
        }

        // Sample tokens using the older sampling API
        let eosToken = llama_token_eos(model)
        let nVocab = llama_n_vocab(model)
        var generatedTokens: [llama_token] = []
        var currentPos = Int32(promptTokens.count)

        for _ in 0..<config.maxTokens {
            guard let logits = llama_get_logits_ith(context, -1) else {
                break
            }

            // Build candidates array
            var candidates: [llama_token_data] = (0..<nVocab).map { tokenId in
                llama_token_data(id: tokenId, logit: logits[Int(tokenId)], p: 0.0)
            }

            var candidatesArray = candidates.withUnsafeMutableBufferPointer { buffer in
                llama_token_data_array(
                    data: buffer.baseAddress,
                    size: buffer.count,
                    sorted: false
                )
            }

            // Apply sampling: top-k, top-p, temperature, then sample
            llama_sample_top_k(context, &candidatesArray, Int32(config.topK), 1)
            llama_sample_top_p(context, &candidatesArray, config.topP, 1)
            llama_sample_temp(context, &candidatesArray, config.temperature)
            let newToken = llama_sample_token(context, &candidatesArray)

            if newToken == eosToken {
                break
            }

            generatedTokens.append(newToken)

            // Decode the new token
            var batch = llama_batch_init(1, 0, 1)
            defer { llama_batch_free(batch) }

            batch.token[0] = newToken
            batch.pos[0] = currentPos
            batch.n_seq_id[0] = 1
            batch.seq_id[0]![0] = 0
            batch.logits[0] = 1
            batch.n_tokens = 1

            let status = llama_decode(context, batch)
            guard status == 0 else { break }

            currentPos += 1
        }

        // Detokenize
        let result = detokenize(generatedTokens, model: model)

        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("llama.cpp generation complete: promptTokens=\(promptTokens.count), generatedTokens=\(generatedTokens.count), responseLength=\(result.count), duration=\(durationMs)ms")
        Self.logger.debug("llama.cpp response text: \(result)")

        return result
    }

    // MARK: - Private

    private func buildPrompt(systemPrompt: String, messages: [LLMMessage], context: String) -> String {
        // Gemma-style chat template
        var prompt = "<start_of_turn>user\n"
        prompt += systemPrompt.replacingOccurrences(of: "{context}", with: context) + "\n\n"

        for message in messages {
            switch message.role {
            case .user:
                prompt += message.content + "\n"
            case .assistant:
                prompt += "<end_of_turn>\n<start_of_turn>model\n"
                prompt += message.content + "\n"
                prompt += "<end_of_turn>\n<start_of_turn>user\n"
            case .system:
                prompt += message.content + "\n"
            }
        }

        prompt += "<end_of_turn>\n<start_of_turn>model\n"
        return prompt
    }

    private func tokenize(_ text: String, model: OpaquePointer) -> [llama_token] {
        let utf8 = Array(text.utf8)
        let maxTokens = utf8.count + 16
        var tokens = [llama_token](repeating: 0, count: maxTokens)

        let nTokens = utf8.withUnsafeBufferPointer { buffer in
            llama_tokenize(model, buffer.baseAddress, Int32(buffer.count), &tokens, Int32(maxTokens), true, true)
        }

        guard nTokens >= 0 else { return [] }
        return Array(tokens.prefix(Int(nTokens)))
    }

    private func detokenize(_ tokens: [llama_token], model: OpaquePointer) -> String {
        var result = ""
        let bufSize = 256
        var buf = [CChar](repeating: 0, count: bufSize)

        for token in tokens {
            let n = llama_token_to_piece(model, token, &buf, Int32(bufSize), false)
            if n > 0 {
                buf[Int(n)] = 0
                result += String(cString: buf)
            }
        }

        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
