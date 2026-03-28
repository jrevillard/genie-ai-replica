// components/gov-chat-backend/services/tool-orchestrator.js
// Multi-round vLLM tool-calling loop. Present for when a raw OpenAI-compatible
// vLLM instance is available. Currently unused because port 9000 on the OPEA
// server rejects tool_choice: "auto" (see MCP-WEATHER-IMPLEMENTATION-GUIDE.md §3).
const axios = require('axios');

const MAX_TOOL_ROUNDS = parseInt(process.env.MAX_TOOL_ROUNDS || '5', 10);

async function runWithTools(llmClient, messages, tools, toolRegistry) {
  const conversationMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await llmClient.chat({ messages: conversationMessages, tools, tool_choice: 'auto' });
    const choice = response.choices[0];

    if (choice.finish_reason === 'stop') {
      return { content: choice.message.content, toolsUsed: round, messages: conversationMessages };
    }

    if (choice.finish_reason === 'tool_calls') {
      conversationMessages.push(choice.message);
      const toolResults = await Promise.all(
        choice.message.tool_calls.map(async (toolCall) => {
          try {
            const result = await toolRegistry.execute(
              toolCall.function.name,
              JSON.parse(toolCall.function.arguments)
            );
            return { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) };
          } catch (err) {
            return { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: err.message }) };
          }
        })
      );
      conversationMessages.push(...toolResults);
    }
  }

  const lastAssistant = [...conversationMessages].reverse().find(m => m.role === 'assistant');
  return { content: lastAssistant?.content || 'Unable to complete the request.', toolsUsed: MAX_TOOL_ROUNDS, messages: conversationMessages };
}

module.exports = { runWithTools };
