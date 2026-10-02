import { modelLabel } from "../../core/pricing";
import type { YearDay } from "../../features/usage/aggregate";
import { formatTokens, heatBucket } from "../ui/charts/format";

const W = 1200;
const H = 630;
const STEPS = ["#1c2230", "#0e4429", "#006d32", "#26a641", "#39d353"];

/**
 * "My Claude Code year": the year's activity map, chats and tokens, streak and
 * favourite model, on a social-card sized PNG. Fixed colours, so it looks the
 * same whichever theme made it. Null where canvas isn't available.
 */
export function yearPng(
  o: { days: YearDay[]; chats: number; tokens: number; streak: number; model: string | null },
  fontFamily: string,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");
  if (!c) return null;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${fontFamily}`;
  c.fillStyle = "#0f1219";
  c.fillRect(0, 0, W, H);
  c.textAlign = "center";
  c.fillStyle = "#f3f5ff";
  c.font = font(56, 700);
  c.fillText("My Claude Code year", W / 2, 120);

  const values = o.days.map((d) => d.tokens);
  const cell = 15;
  const gap = 4;
  const weeks = Math.ceil(o.days.length / 7);
  const gridW = weeks * (cell + gap) - gap;
  const x0 = (W - gridW) / 2;
  const y0 = 190;
  o.days.forEach((d, i) => {
    c.fillStyle = STEPS[heatBucket(d.tokens, values)]!;
    c.beginPath();
    c.roundRect?.(
      x0 + Math.floor(i / 7) * (cell + gap),
      y0 + (i % 7) * (cell + gap),
      cell,
      cell,
      3,
    );
    if (!c.roundRect)
      c.rect(x0 + Math.floor(i / 7) * (cell + gap), y0 + (i % 7) * (cell + gap), cell, cell);
    c.fill();
  });

  c.fillStyle = "#e7e9f2";
  c.font = font(40, 600);
  c.fillText(`${o.chats.toLocaleString()} chats · ${formatTokens(o.tokens)} tokens`, W / 2, 440);
  const sub = [
    o.streak > 1 ? `🔥 ${o.streak}-day streak` : "",
    o.model ? `mostly ${modelLabel(o.model)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (sub) {
    c.fillStyle = "#a8aec4";
    c.font = font(30);
    c.fillText(sub, W / 2, 500);
  }
  c.fillStyle = "#6f7690";
  c.font = font(24, 500);
  c.fillText("Orbit HQ for Claude Code", W / 2, H - 44);
  return canvas.toDataURL("image/png");
}
