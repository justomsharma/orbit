let nextName = 0;

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** A row of mutually exclusive choices (a radio group that looks like a switch). */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
}) {
  const name = `seg-${++nextName}`;
  return (
    <fieldset class="segmented">
      <legend class="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} class={value === o.value ? "on" : ""}>
          <input
            type="radio"
            name={name}
            class="sr-only"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
          {o.count !== undefined ? <span class="seg-count">{o.count}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}
