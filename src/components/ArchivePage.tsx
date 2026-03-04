import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { fetchArchive } from "../lib/api";
import { OrderCard } from "./OrderCard";
import type { Order } from "../types";

type Tab = "sewing" | "cutting";

export const ArchivePage = () => {
  const [tab, setTab] = useState<Tab>("sewing");

  const { data = [], isLoading, isFetching, refetch } = useQuery<Order[]>({
    queryKey: ["archive"],
    queryFn: fetchArchive,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const sewingOrders = data.filter((o) => o.status === "in-progress");
  const cuttingOrders = data.filter((o) => o.status === "cutting");

  const displayed = tab === "sewing" ? sewingOrders : cuttingOrders;

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`btn mini ${tab === "sewing" ? "primary" : "ghost"}`}
            onClick={() => setTab("sewing")}
          >
            Пошиття ({sewingOrders.length})
          </button>
          <button
            className={`btn mini ${tab === "cutting" ? "primary" : "ghost"}`}
            onClick={() => setTab("cutting")}
          >
            Розкрій ({cuttingOrders.length})
          </button>
        </div>
        <button className="btn mini ghost refresh-btn" onClick={() => refetch()} disabled={isFetching}>
          <RotateCcw size={14} />
          <span className="btn-label">{isFetching ? "Оновлюю..." : "Оновити"}</span>
        </button>
      </div>

      {isLoading && <div className="muted">Завантажую...</div>}
      {!isLoading && displayed.length === 0 && (
        <div className="muted">Архів порожній.</div>
      )}

      <div className="cards-list">
        {displayed.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
          />
        ))}
      </div>
    </div>
  );
};
