// components/gov-chat-backend/services/tool-registry.js
class ToolRegistry {
  constructor() { this._tools = new Map(); }

  register(definition, handler) {
    this._tools.set(definition.function.name, { definition, handler });
  }

  async execute(name, args) {
    const tool = this._tools.get(name);
    if (!tool) throw new Error(`Unknown tool: "${name}"`);
    return await tool.handler(args);
  }

  getDefinitions() { return [...this._tools.values()].map(t => t.definition); }
  list() { return [...this._tools.keys()]; }
}

module.exports = new ToolRegistry(); // singleton
