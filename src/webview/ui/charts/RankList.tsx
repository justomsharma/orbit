export interface RankItem {
  key: string;
  label: string;
  value: number;
  display: string;
  sub?: string;
}

interface Props {
  title: string;
  items: RankItem[];
}

const pct = (v: number, max: number) => `${max > 0 ? Math.round((v / max) * 1000) / 10 : 0}%`;

/** Ranked rows with a thin proportional bar; values in text, bars carry only magnitude. */
export function RankList({ title, items }: Props) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <section class="rank card" aria-label={title}>
      <h3 class="section-title">{title}</h3>
      <ul class="rank-list">
        {items.map((i) => (
          <li key={i.key} class="rank-row">
            <div class="rank-text">
              <span class="rank-label" title={i.sub ?? i.label}>
                {i.label}
              </span>
              <span class="rank-value">{i.display}</span>
            </div>
            <div class="rank-bar" aria-hidden="true">
              <div class="rank-bar-fill" style={{ width: pct(i.value, max) }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
