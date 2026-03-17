export type Priority = "Критично" | "Терміново" | "Низький" | "Дефіцит";

export interface CutStockItem {
  stockId: string;
  dtId?: number;
  sku: string;
  size: string;
  qty: number;
  shelf: string;
  cutDate: string;
  status: "available" | "used";
}

export type OrderStatus = "incoming" | "cutting" | "in-progress" | "done" | "archived";

export interface Order {
  id: string;
  dtId?: number;
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
  cutting_qty?: number;
  shelf?: string;
  updatedAt?: string;
  createdAt?: string;
}
