// LlamaCppProvider.swift
// LLM provider wrapping the llama.cpp C API.
//
// Rewritten for the post-mid-2024 llama.cpp ABI used by mattt/llama.swift
// (currently tracking upstream build b9128). The major API shifts since
// the previous StanfordBDHG/llama.cpp v0.3.3 vintage:
//
//   - Model lifecycle:  llama_load_model_from_file → llama_model_load_from_file
//                       llama_free_model           → llama_model_free
//                       llama_new_context_with_model → llama_init_from_model
//   - Vocab access:     methods on the model now go through a vocab handle
//                       obtained via llama_model_get_vocab. llama_token_eos,
//                       llama_n_vocab, llama_tokenize, and llama_token_to_piece
//                       all take `const struct llama_vocab *` instead of the
//                       model pointer.
//   - Sampling:         the old free-standing llama_sample_top_k / top_p /
//                       temp / token functions are gone. Build a
//                       llama_sampler_chain, add init_top_k / init_top_p /
//                       init_temp / init_dist samplers, and call
//                       llama_sampler_sample (smpl, ctx, idx). Free the
//                       chain when the context is torn down.
//   - KV cache:         llama_kv_cache_clear is replaced by
//                       llama_memory_clear (llama_get_memory(ctx), true).
//
// The public surface of this actor (LLMProvider conformance) is unchanged.

import Foundation
import LlamaSwift
import os

public actor LlamaCppProvider: LLMProvider {
    private let modelPath: String
    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var sampler: UnsafeMutablePointer<llama_sampler>?
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

        guard let loadedModel = llama_model_load_from_file(modelPath, modelParams) else {
            Self.logger.error("Failed to load model from path=\(self.modelPath, privacy: .private)")
            throw LocalRAGError.modelLoadFailed("Failed to load model from \(modelPath)")
        }
        self.model = loadedModel

        // Create context. Gemma 2 2B was trained at n_ctx_train=8192;
        // the prior 4096 setting was leaving ~half the model's natural
        // window on the floor and forcing context-overflow failures
        // (llama_decode status 1) the moment we tried topK > 8 with the
        // 1200-char chunk size LocalRAGBridge uses. 6144 is a middle
        // ground: enough headroom for topK=10 + system prompt without
        // doubling the KV-cache memory cost on small devices.
        var contextParams = llama_context_default_params()
        contextParams.n_ctx = 6144
        contextParams.n_batch = 512

        guard let ctx = llama_init_from_model(loadedModel, contextParams) else {
            llama_model_free(loadedModel)
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
        if let smpl = sampler {
            llama_sampler_free(smpl)
            self.sampler = nil
        }
        if let ctx = context {
            llama_free(ctx)
            self.context = nil
        }
        if let mdl = model {
            llama_model_free(mdl)
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
        guard let vocab = llama_model_get_vocab(model) else {
            throw LocalRAGError.generationFailed("llama_model_get_vocab returned nil")
        }

        Self.logger.info("llama.cpp generate: systemPromptLength=\(systemPrompt.count), messages=\(messages.count), contextLength=\(contextText.count), maxTokens=\(config.maxTokens), temperature=\(config.temperature, format: .fixed(precision: 2)), topK=\(config.topK), topP=\(config.topP, format: .fixed(precision: 2))")
        Self.logger.debug("llama.cpp system prompt: \(systemPrompt)")

        let clock = ContinuousClock()
        let startTime = clock.now

        // Build chat prompt in Gemma/ChatML format
        let prompt = buildPrompt(systemPrompt: systemPrompt, messages: messages, context: contextText)
        Self.logger.debug("llama.cpp full prompt: \(prompt)")

        // Tokenize
        let promptTokens = tokenize(prompt, vocab: vocab)
        guard !promptTokens.isEmpty else {
            Self.logger.error("Failed to tokenize prompt (length=\(prompt.count))")
            throw LocalRAGError.generationFailed("Failed to tokenize prompt")
        }

        Self.logger.info("Tokenized prompt: promptTokens=\(promptTokens.count)")

        // Clear KV cache via the new memory API
        if let mem = llama_get_memory(context) {
            llama_memory_clear(mem, true)
        }

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

        // Build a fresh sampler chain for this generation. The chain owns
        // the individual samplers; freeing the chain frees them all.
        let smpl = makeSamplerChain(config: config)
        defer {
            llama_sampler_free(smpl)
        }

        let eosToken = llama_vocab_eos(vocab)
        var generatedTokens: [llama_token] = []
        var currentPos = Int32(promptTokens.count)

        for _ in 0..<config.maxTokens {
            let newToken = llama_sampler_sample(smpl, context, -1)
            if newToken == eosToken {
                break
            }
            llama_sampler_accept(smpl, newToken)
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
        let result = detokenize(generatedTokens, vocab: vocab)

        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("llama.cpp generation complete: promptTokens=\(promptTokens.count), generatedTokens=\(generatedTokens.count), responseLength=\(result.count), duration=\(durationMs)ms")
        Self.logger.debug("llama.cpp response text: \(result)")

        return result
    }

    // MARK: - Private

    private func makeSamplerChain(config: LLMGenerationConfig) -> UnsafeMutablePointer<llama_sampler> {
        var chainParams = llama_sampler_chain_default_params()
        let chain = llama_sampler_chain_init(chainParams)!
        // Apply top-k, then top-p, then temperature, then a stochastic
        // distribution sampler at the end. Order matters: filters narrow
        // the candidate set, dist picks one. Temperature ≤ 0 is degenerate
        // (greedy) — short-circuit to the greedy sampler in that case.
        if config.temperature <= 0 {
            llama_sampler_chain_add(chain, llama_sampler_init_greedy())
        } else {
            llama_sampler_chain_add(chain, llama_sampler_init_top_k(Int32(config.topK)))
            llama_sampler_chain_add(chain, llama_sampler_init_top_p(config.topP, 1))
            llama_sampler_chain_add(chain, llama_sampler_init_temp(config.temperature))
            llama_sampler_chain_add(chain, llama_sampler_init_dist(LLAMA_DEFAULT_SEED))
        }
        _ = chainParams // silence the unused-warning for any future tweaks
        return chain
    }

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

    private func tokenize(_ text: String, vocab: OpaquePointer) -> [llama_token] {
        let utf8 = Array(text.utf8)
        let maxTokens = utf8.count + 16
        var tokens = [llama_token](repeating: 0, count: maxTokens)

        let nTokens = utf8.withUnsafeBufferPointer { buffer in
            buffer.baseAddress!.withMemoryRebound(to: CChar.self, capacity: buffer.count) { charPtr in
                llama_tokenize(vocab, charPtr, Int32(buffer.count), &tokens, Int32(maxTokens), true, true)
            }
        }

        guard nTokens >= 0 else { return [] }
        return Array(tokens.prefix(Int(nTokens)))
    }

    private func detokenize(_ tokens: [llama_token], vocab: OpaquePointer) -> String {
        var result = ""
        let bufSize = 256
        var buf = [CChar](repeating: 0, count: bufSize)

        for token in tokens {
            let n = llama_token_to_piece(vocab, token, &buf, Int32(bufSize), 0, false)
            if n > 0 {
                buf[Int(n)] = 0
                result += String(cString: buf)
            }
        }

        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
