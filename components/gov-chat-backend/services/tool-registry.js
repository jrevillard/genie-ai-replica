/**
 * Singleton Tool Registry
 *
 * Maps tool names to their OpenAI-format definitions and async handler functions.
 * Exported as a singleton so every require('./tool-registry') call returns the
 * same instance — tools registered during startup are available at request time.
 */
class ToolRegistry {
  constructor() {
    this._tools = new Map(); // name → { definition, handler }
  }

  /**
   * Register a tool with its OpenAI-format definition and async handler.
   * @param {Object} definition - OpenAI tool definition ({ type: 'function', function: { name, description, parameters } })
   * @param {Function} handler  - async function(args) → result
   */
  register(definition, handler) {
    const name = definition.function.name;
    this._tools.set(name, { definition, handler });
  }

  /**
   * Execute a registered tool by name.
   * @param {string} name - Tool name
   * @param {Object} args - Parsed arguments from the LLM
   * @returns {Promise<*>} Tool result
   */
  async execute(name, args) {
    const tool = this._tools.get(name);
    if (!tool) throw new Error(`Unknown tool: "${name}"`);
    return await tool.handler(args);
  }

  /**
   * Returns an array of all registered OpenAI tool definitions.
   * @returns {Array}
   */
  getDefinitions() {
    return [...this._tools.values()].map(t => t.definition);
  }

  /**
   * Returns an array of all registered tool names.
   * @returns {string[]}
   */
  list() {
    return [...this._tools.keys()];
  }
}

module.exports = new ToolRegistry(); // singleton export