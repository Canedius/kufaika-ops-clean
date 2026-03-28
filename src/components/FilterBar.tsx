import { useState } from "react";
import type { Priority, SortLevel, SortField } from "../types";

const FIELD_LABELS: Record<SortField, string> = {
  priority: "Терміновість",
  date: "Дата",
  sku: "SKU",
  size: "Розмір",
};

const ALL_FIELDS: SortField[] = ["priority", "date", "sku", "size"];

type Props = {
  onSearch: (term: string) => void;
  onPriority: (priority: Priority | "all") => void;
  sorts: SortLevel[];
  onSortsChange: (sorts: SortLevel[]) => void;
};

export const FilterBar = ({ onSearch, onPriority, sorts, onSortsChange }: Props) => {
  const [term, setTerm] = useState("");

  const updateLevel = (idx: number, patch: Partial<SortLevel>) => {
    onSortsChange(sorts.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeLevel = (idx: number) => {
    const next = sorts.filter((_, i) => i !== idx);
    onSortsChange(next.length ? next : [{ field: "priority", dir: "desc" }]);
  };

  const addLevel = () => {
    const used = new Set(sorts.map((s) => s.field));
    const next = ALL_FIELDS.find((f) => !used.has(f));
    if (!next) return;
    onSortsChange([...sorts, { field: next, dir: "asc" }]);
  };

  const canAdd = sorts.length < ALL_FIELDS.length;

  return (
    <div className="filters">
      <input
        className="input"
        placeholder="Пошук за SKU або кольором"
        value={term}
        onChange={(e) => {
          const val = e.target.value;
          setTerm(val);
          onSearch(val);
        }}
      />
      <select className="select" onChange={(e) => onPriority(e.target.value as Priority | "all")}>
        <option value="all">Всі пріоритети</option>
        <option value="Критично">Критично</option>
        <option value="Терміново">Терміново</option>
        <option value="Дефіцит">Дефіцит</option>
        <option value="Низький">Низький</option>
      </select>

      <div className="sort-levels">
        {sorts.map((s, idx) => {
          const usedFields = new Set(sorts.map((x, i) => (i !== idx ? x.field : null)));
          return (
            <div key={idx} className="sort-chip">
              {idx === 0 ? (
                <span className="sort-chip-label">Сортування:</span>
              ) : (
                <span className="sort-chip-label muted">потім:</span>
              )}
              <select
                className="select select--compact"
                value={s.field}
                onChange={(e) => updateLevel(idx, { field: e.target.value as SortField })}
              >
                {ALL_FIELDS.map((f) => (
                  <option key={f} value={f} disabled={usedFields.has(f)}>
                    {FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
              <button
                className="btn mini ghost sort-dir-btn"
                title={s.dir === "asc" ? "За зростанням" : "За спаданням"}
                onClick={() => updateLevel(idx, { dir: s.dir === "asc" ? "desc" : "asc" })}
              >
                {s.dir === "asc" ? "↑" : "↓"}
              </button>
              {sorts.length > 1 && (
                <button className="btn mini ghost sort-remove-btn" onClick={() => removeLevel(idx)}>
                  ×
                </button>
              )}
            </div>
          );
        })}
        {canAdd && (
          <button className="btn mini ghost sort-add-btn" onClick={addLevel}>
            + рівень
          </button>
        )}
      </div>
    </div>
  );
};
