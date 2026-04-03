/**
 * Tool Orchestrator — Agentic Multi-Round Tool Loop
 *
 * Implements an OpenAI-compatible multi-round tool-calling loop.
 * The LLM is called repeatedly (up to MAX_TOOL_ROUNDS) until it signals
 * finish_reason === 'stop', executing any requested tools in parallel each round.
 */
const { logger } = require('../shared-lib');

const MAX_TOOL_ROUNDS = parseInt(process.env.MAX_TOOL_ROUNDS || '5', 10);

/**
 * Run an agentic tool loop against an OpenAI-compatible LLM.
 *
 * @param {Object}   llmClient    - Client with a chat({ messages, tools, tool_choice }) method
 * @param {Array}    messages     - Initial message array
 * @param {Array}    tools        - Array of OpenAI tool definitions
 * @param {Object}   toolRegistry - ToolRegistry singleton
 * @returns {Promise<{ content: string, toolsUsed: number, messages: Array }>}
 */
async function runWithTools(llmClient, messages, tools, toolRegistry) {
  const conversationMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    logger.info(`[TOOL-ORCHESTRATOR] Round ${round + 1}/${MAX_TOOL_ROUNDS}`);

    const response = await llmClient.chat({
      messages: conversationMessages,
      tools,
      tool_choice: 'auto'
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'stop') {
      logger.info(`[TOOL-ORCHESTRATOR] LLM signalled stop after ${round + 1} round(s)`);
      return {
        content: choice.message.content,
        toolsUsed: round,
        messages: conversationMessages
      };
    }

    if (choice.finish_reason === 'tool_calls') {
      conversationMessages.push(choice.message);

      const toolResults = await Promise.all(
        choice.message.tool_calls.map(async (toolCall) => {
          logger.info(`[TOOL-ORCHESTRATOR] Executing tool: ${toolCall.function.name}`);
          try {
            const result = await toolRegistry.execute(
              toolCall.function.name,
              JSON.parse(toolCall.function.arguments)
            );
            return {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            };
          } catch (err) {
            logger.error(`[TOOL-ORCHESTRATOR] Tool ${toolCall.function.name} failed: ${err.message}`);
            return {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: err.message })
            };
          }
        })
      );

      conversationMessages.push(...toolResults);
    }
  }

  // Safety: exceeded max rounds — return last partial answer
  logger.warn(`[TOOL-ORCHESTRATOR] Exceeded MAX_TOOL_ROUNDS (${MAX_TOOL_ROUNDS}). Returning last partial answer.`);
  const lastAssistantMsg = [...conversationMessages].reverse().find(m => m.role === 'assistant');
  return {
    content: lastAssistantMsg?.content || 'I was unable to complete the request within the allowed number of steps.',
    toolsUsed: MAX_TOOL_ROUNDS,
    messages: conversationMessages
  };
}

module.exports = { runWithTools };