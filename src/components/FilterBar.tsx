import { useState } from "react";
import type { Priority } from "../types";

type Props = {
  onSearch: (term: string) => void;
  onPriority: (priority: Priority | "all") => void;
  onSort: (sort: "priority" | "date" | "sku") => void;
};

export const FilterBar = ({ onSearch, onPriority, onSort }: Props) => {
  const [term, setTerm] = useState("");

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
      <select className="select" onChange={(e) => onSort(e.target.value as "priority" | "date" | "sku")}>
        <option value="priority">Сортувати: терміновість</option>
        <option value="date">Сортувати: дата запуску</option>
        <option value="sku">Сортувати: SKU</option>
      </select>
    </div>
  );
};
