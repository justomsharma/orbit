import { modelLabel } from "../../core/pricing";
import type { Recap } from "../../features/usage/recap";
import { formatCost, formatTokens } from "../ui/charts/format";

const W = 1200;
const H = 630;

/**
 * Draws a shareable "my week with Claude Code" card (social-card size) and
 * returns it as a PNG data URL, or null where canvas is unavailable. Uses a
 * fixed palette so the image looks the same whichever editor theme made it.
 */
export function recapPng(
  r: Recap,
  fontFamily: string,
  week: { day: string; tokens: number }[] = [],
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");
  if (!c) return null;

  const grad = c.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#14161f");
  grad.addColorStop(1, "#1f2433");
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);

  const font = (size: number, weight = 400) => `${weight} ${size}px ${fontFamily}`;
  const from = new Date(r.from).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const to = new Date(r.to).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  c.fillStyle = "#9aa4bf";
  c.font = font(28);
  c.fillText(`My week with Claude Code · ${from} – ${to}`, 72, 104);

  const stats: [string, string][] = [
    [String(r.chats), r.chats === 1 ? "chat" : "chats"],
    [String(r.prompts), "prompts"],
    [formatTokens(r.tokens), "tokens"],
    [`${r.activeDays}/7`, "active days"],
  ];
  stats.forEach(([value, label], i) => {
    const x = 72 + i * 270;
    c.fillStyle = "#ffffff";
    c.font = font(76, 600);
    c.fillText(value, x, 250);
    c.fillStyle = "#9aa4bf";
    c.font = font(26);
    c.fillText(label, x, 292);
  });

  c.fillStyle = "#d7dcea";
  c.font = font(30);
  const lines = [
    r.topProjects.length ? `Most time in ${r.topProjects.map((p) => p.name).join(", ")}` : null,
    r.busiestDay ? `Busiest day: ${r.busiestDay}` : null,
    r.prs.length ? `${r.prs.length} pull request${r.prs.length === 1 ? "" : "s"} opened` : null,
    r.models.length ? `With ${[...new Set(r.models.map(modelLabel))].join(", ")}` : null,
    r.cost !== null ? `${formatCost(r.cost)} of API value` : null,
  ].filter((l): l is string => l !== null);
  lines.slice(0, 4).forEach((l, i) => {
    c.fillText(l, 72, 390 + i * 46);
  });

  // Seven small columns: tokens per day this week, weekday initials below.
  const max = Math.max(1, ...week.map((d) => d.tokens));
  week.slice(-7).forEach((d, i) => {
    const x = 800 + i * 50;
    const h = Math.round((d.tokens / max) * 170);
    c.fillStyle = h > 0 ? "#6ea8fe" : "#2c3347";
    c.beginPath();
    c.roundRect(x, 560 - Math.max(h, 4), 30, Math.max(h, 4), [6, 6, 0, 0]);
    c.fill();
    c.fillStyle = "#6b7390";
    c.font = font(20);
    const wd = new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" });
    c.fillText(wd, x + 8, 592);
  });

  c.fillStyle = "#6b7390";
  c.font = font(22);
  c.fillText("Made with Orbit for VS Code", 72, H - 56);
  return canvas.toDataURL("image/png");
}
