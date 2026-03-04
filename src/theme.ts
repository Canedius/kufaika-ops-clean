import type { Priority, OrderStatus } from "./types";

export const priorityTone: Record<Priority, string> = {
  Критично: "tone-red",
  Терміново: "tone-amber",
  Низький: "tone-green",
  Дефіцит: "tone-purple",
};

export const statusLabel: Record<OrderStatus, string> = {
  incoming: "Замовлення на пошив",
  cutting: "В розкрої",
  "in-progress": "Взято в роботу",
  done: "Виготовлено",
  archived: "Архів",
};

export const statusTone: Record<OrderStatus, string> = {
  incoming: "tone-blue",
  cutting: "tone-orange",
  "in-progress": "tone-amber",
  done: "tone-green",
  archived: "tone-muted",
};
