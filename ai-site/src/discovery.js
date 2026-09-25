/**
 * Remote MCP discovery.
 *
 * As of 2026-09 the experimental Server Card extension
 * (modelcontextprotocol/experimental-ext-server-card) uses:
 * - domain discovery: GET /.well-known/ai-catalog.json (AI Catalog)
 * - server card: GET {streamable-http-url}/server-card  → /mcp/server-card
 *
 * /.well-known/mcp.json is the same AI Catalog document (owner URL).
 * It is not a separate schema.
 */

export const SERVER_NAME = "ai.game-intel/public";
export const SERVER_VERSION = "0.1.0";
export const SERVER_TITLE = "game-intel public";
export const PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
];
export const MODERN_PROTOCOL = "2026-07-28";
export const LEGACY_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];

export const SERVER_DESCRIPTION =
  "Read-only mirror of public game-intel JSON (guides, digest, radar, games).";

const SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";

export function mcpEndpoint(origin) {
  return `${origin}/mcp`;
}

export function serverCardUrl(origin) {
  return `${origin}/mcp/server-card`;
}

export function aiCatalog(origin) {
  const host = new URL(origin).host;
  return {
    specVersion: "1.0",
    entries: [
      {
        identifier: `urn:air:${host}:mcp:public`,
        type: "application/mcp-server-card+json",
        url: serverCardUrl(origin),
      },
    ],
  };
}

export function serverCard(origin) {
  return {
    $schema: SCHEMA,
    name: SERVER_NAME,
    version: SERVER_VERSION,
    title: SERVER_TITLE,
    description: SERVER_DESCRIPTION,
    websiteUrl: "https://game-intel-ai.dyk1454683243.workers.dev",
    repository: {
      url: "https://github.com/dyk1454683243-sudo/game-intel-site",
      source: "github",
      subfolder: "ai-site",
    },
    remotes: [
      {
        type: "streamable-http",
        url: mcpEndpoint(origin),
        supportedProtocolVersions: PROTOCOL_VERSIONS,
      },
    ],
  };
}
