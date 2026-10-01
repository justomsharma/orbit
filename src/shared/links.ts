/** The only outside pages Orbit's own buttons open (chat PR links are checked separately). */
export const ORBIT_LINKS = {
  repo: "https://github.com/justomsharma/orbit",
  issue: "https://github.com/justomsharma/orbit/issues/new",
  rate: "https://marketplace.visualstudio.com/items?itemName=OmSharma.orbit-hq&ssr=false#review-details",
  skills: "https://github.com/anthropics/skills",
  mcp: "https://github.com/modelcontextprotocol/servers",
  claudeUsage: "https://claude.ai/settings/usage",
} as const;

export type OrbitLink = keyof typeof ORBIT_LINKS;
export const ORBIT_LINK_IDS = Object.keys(ORBIT_LINKS) as OrbitLink[];
