import type { Priority, OrderStatus } from "./types";

export const priorityTone: Record<Priority, string> = {
  Критично: "tone-red",
  Терміново: "tone-amber",
  Низький: "tone-green",
  Дефіцит: "tone-purple",
};

export const statusLabel: Record<OrderStatus, string> = {
  incoming: "Замовлення на пошив",
  "in-progress": "Взято в роботу",
  done: "Виготовлено",
};

export const statusTone: Record<OrderStatus, string> = {
  incoming: "tone-blue",
  "in-progress": "tone-amber",
  done: "tone-green",
};
