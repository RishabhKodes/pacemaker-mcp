#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { getPcsTools } from "./tools/pcs.js";

async function main(): Promise<void> {
  const server = new Server(
    {
      name: "pacemaker-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const tools = getPcsTools();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    } satisfies typeof ListToolsResultSchema._output;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const toolResult = await tool.handler(args);
    // Return the tool's content directly in the CallTool response
    return toolResult;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error:", err);
  process.exit(1);
});


