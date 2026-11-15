import { useId, useState } from "react";

/** Native single-choice inputs presented as tap-friendly buttons. */
export function ChoiceField({
  label,
  name,
  options,
  value,
  defaultValue = "",
  onChange,
  onSelect,
  required = false,
  hint,
}: {
  label: string;
  name?: string;
  options: { value: string | number; label: string }[];
  value?: string;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  onSelect?: (value: string) => void;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [selection, setSelection] = useState(String(defaultValue));
  const selected = value ?? selection;
  return (
    <fieldset
      className="choice-field full-width"
      aria-describedby={hint ? `${id}-hint` : undefined}
    >
      <legend>{label}</legend>
      <div className="choice-options">
        {options.map((option) => (
          <label className="choice-option" key={option.value}>
            <input
              type="radio"
              name={name ?? id}
              value={option.value}
              checked={selected === String(option.value)}
              required={required}
              onClick={() => onSelect?.(String(option.value))}
              onChange={() => {
                setSelection(String(option.value));
                onChange?.(String(option.value));
              }}
            />
            <span className="choice-button">
              <span>{option.label}</span>
            </span>
          </label>
        ))}
      </div>
      {!options.length && <small>No options available.</small>}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </fieldset>
  );
}
