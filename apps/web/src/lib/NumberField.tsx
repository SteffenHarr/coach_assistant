import { useEffect, useState } from "react";

type Props = {
  value: number | null;
  onChange: (v: number | null) => void;
  /** When true (default), empty input means "no value" → null. Otherwise empty becomes 0. */
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  id?: string;
};

/**
 * Number input that:
 *   - keeps the raw string locally so the user can clear it without seeing "0"
 *   - never displays leading-zero artefacts like "05"
 *   - reports `null` to the parent when the field is empty (if nullable)
 *   - clamps to [min, max] only on blur (not while typing) so partial entry works
 */
export function NumberField({
  value,
  onChange,
  nullable = true,
  min,
  max,
  step,
  placeholder,
  disabled,
  style,
  id,
}: Props) {
  const [text, setText] = useState<string>(value == null ? "" : String(value));

  // Re-sync from parent when value changes externally (e.g. data loaded).
  useEffect(() => {
    const incoming = value == null ? "" : String(value);
    // Avoid overwriting in-progress edits that parse to the same number.
    const parsed = parseFloat(text);
    if (text === "" || isNaN(parsed) || parsed !== value) {
      setText(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(raw: string) {
    if (raw.trim() === "") {
      onChange(nullable ? null : 0);
      return;
    }
    let n = parseFloat(raw.replace(",", "."));
    if (isNaN(n)) {
      // Reset to last good value.
      setText(value == null ? "" : String(value));
      return;
    }
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    // Normalise the displayed string (strips leading zeros like "05" → "5").
    setText(String(n));
    onChange(n);
  }

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      style={style}
    />
  );
}
