import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOrders } from "../lib/api";
import type { Order } from "../types";

export function useExcelExport() {
  const [exporting, setExporting] = useState(false);
  const { data: allOrders = [] } = useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: fetchOrders,
    staleTime: 2 * 60_000,
  });

  const activeOrders = allOrders.filter((o) => o.status === "incoming");

  const exportToExcel = async () => {
    if (exporting || activeOrders.length === 0) return;
    setExporting(true);
    try {
      const { generateWorkbook, downloadWorkbook } = await import("../lib/exportExcel");
      const wb = generateWorkbook(activeOrders);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      await downloadWorkbook(wb, `Замовлення_${date}.xlsx`);
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setExporting(false);
    }
  };

  return { exportToExcel, exporting, count: activeOrders.length };
}
