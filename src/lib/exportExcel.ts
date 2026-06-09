import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import type { Order, Priority } from "../types";

interface SizeEntry {
  qty: number;
  priority: Priority;
}

interface CrossTableRow {
  productName: string;
  color: string;
  fabric: string;
  sku: string;
  totalQty: number;
  sizes: Record<string, SizeEntry>;
  comment: string;
}

const SIZE_COLUMNS = ["XS", "XS/S", "S", "M", "M/L", "L", "XL", "XL/2XL", "2XL", "3XL"] as const;

const SIZE_NORMALIZE: Record<string, string> = {
  "XS":     "XS",
  "XS/S":   "XS/S",
  "S":      "S",
  "M":      "M",
  "M/L":    "M/L",
  "L":      "L",
  "XL":     "XL",
  "XL/XXL": "XL/2XL",
  "XL/2XL": "XL/2XL",
  "XXL":    "2XL",
  "2XL":    "2XL",
  "3XL":    "3XL",
  "4XL":    "4XL",
};

const PRIORITY_FILL: Record<Priority, string> = {
  "Критично":  "FFFF0000",
  "Терміново": "FFFFF200",
  "Дефіцит":   "FF8B5CF6",
  "Низький":   "FF92D050",
};

const PRIORITY_RANK: Record<Priority, number> = {
  "Критично": 0,
  "Терміново": 1,
  "Дефіцит": 2,
  "Низький": 3,
};

function higherPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}

function groupKey(order: Order): string {
  // Тканина і ознака «індивідуальне» — частина ключа, щоб різні матеріали
  // та індивідуальні замовлення не сумувались зі складськими.
  return `${order.productType}::${order.color}::${order.fabric || ""}::${order.individual ? "ind" : "stock"}`;
}

export function aggregateOrders(orders: Order[]): CrossTableRow[] {
  const groups = new Map<string, Order[]>();

  for (const o of orders) {
    const key = groupKey(o);
    const arr = groups.get(key);
    if (arr) arr.push(o);
    else groups.set(key, [o]);
  }

  const rows: CrossTableRow[] = [];

  for (const [, group] of groups) {
    const first = group[0];
    const sizes: Record<string, SizeEntry> = {};

    for (const o of group) {
      const col = SIZE_NORMALIZE[o.size] || SIZE_NORMALIZE[o.size.toUpperCase()] || o.size;
      const existing = sizes[col];
      if (existing) {
        existing.qty += o.quantity;
        existing.priority = higherPriority(existing.priority, o.priority);
      } else {
        sizes[col] = { qty: o.quantity, priority: o.priority };
      }
    }

    const totalQty = Object.values(sizes).reduce((a, b) => a + b.qty, 0);

    const comments = group.map((o) => o.comment).filter(Boolean);

    rows.push({
      productName: first.productType,
      color: first.color,
      fabric: first.fabric || "",
      sku: first.sku.slice(0, 6),
      totalQty,
      sizes,
      comment: [...new Set(comments)].join("; "),
    });
  }

  rows.sort((a, b) =>
    a.productName.localeCompare(b.productName) ||
    a.color.localeCompare(b.color) ||
    a.fabric.localeCompare(b.fabric),
  );

  return rows;
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  bottom: { style: "thin" },
  left: { style: "thin" },
  right: { style: "thin" },
};

export function generateWorkbook(orders: Order[]): ExcelJS.Workbook {
  const rows = aggregateOrders(orders);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Замовлення на пошив");

  const COL_DEFS = [
    { header: "Назва виробу",     width: 22 },
    { header: "Колір",            width: 16 },
    { header: "Тканина",          width: 24 },
    { header: "SKU",              width: 12 },
    { header: "Заг. К-ть",       width: 10 },
    ...SIZE_COLUMNS.map((s) => ({ header: s, width: s.length > 6 ? 12 : 6 })),
    { header: "Термін виконання", width: 16 },
    { header: "№ замовлення",     width: 14 },
    { header: "Бірка на спині",   width: 14 },
    { header: "Примітки",         width: 24 },
  ];

  // Set column widths
  COL_DEFS.forEach((def, i) => {
    ws.getColumn(i + 1).width = def.width;
  });

  // Header row
  const headerRow = ws.getRow(1);
  COL_DEFS.forEach((def, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = def.header;
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    cell.border = THIN_BORDER;
  });
  headerRow.height = 32;

  // Column indices (1-based)
  const COL_TOTAL = 5;
  const COL_SIZE_START = 6; // first size column
  const COL_SIZE_END = COL_SIZE_START + SIZE_COLUMNS.length - 1;

  // Data rows
  for (const row of rows) {
    const values: (string | number)[] = [
      row.productName,
      row.color,
      row.fabric,
      row.sku,
      row.totalQty,
      ...SIZE_COLUMNS.map((s) => row.sizes[s]?.qty || ""),
      "",  // Термін виконання
      "",  // № замовлення
      "",  // Бірка на спині
      row.comment,
    ];

    const dataRow = ws.addRow(values);
    dataRow.font = { size: 10 };
    dataRow.alignment = { vertical: "middle" };

    // Borders on all cells
    for (let c = 1; c <= COL_DEFS.length; c++) {
      dataRow.getCell(c).border = THIN_BORDER;
    }

    // Center-align total + size columns
    for (let c = COL_TOTAL; c <= COL_SIZE_END; c++) {
      dataRow.getCell(c).alignment = { horizontal: "center", vertical: "middle" };
    }

    // Color each size cell individually by its priority
    for (let i = 0; i < SIZE_COLUMNS.length; i++) {
      const sizeKey = SIZE_COLUMNS[i];
      const entry = row.sizes[sizeKey];
      if (entry && entry.qty > 0) {
        const cell = dataRow.getCell(COL_SIZE_START + i);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: PRIORITY_FILL[entry.priority] },
        };
      }
    }
  }

  // Auto-filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COL_DEFS.length },
  };

  return wb;
}

export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.document",
  });
  saveAs(blob, filename);
}
