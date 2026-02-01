export type Priority = "Критично" | "Терміново" | "Низький" | "Дефіцит";

export type OrderStatus = "incoming" | "in-progress" | "done";

export interface Order {
  id: string;
  sku: string;
  productType: string;
  fabric?: string;
  color: string;
  size: string;
  quantity: number;
  boxes: number;
  priority: Priority;
  status: OrderStatus;
  launchDate: string;
  comment?: string;
  currentAvailable?: number;
  targetQty?: number;
}
