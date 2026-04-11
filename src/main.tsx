import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import App from "./App";
import "./index.css";
import { OrdersPage } from "./components/OrdersPage";
import { ArchivePage } from "./components/ArchivePage";

const AnalyticsPage = lazy(() => import("./components/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));

const qc = new QueryClient();

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/incoming" replace /> },
      {
        path: "incoming",
        element: (
          <OrdersPage
            key="incoming"
            filterBy={["incoming"]}
            emptyText="Тут поки немає замовлень."
            actions={{ cut: true, sew: true }}
          />
        ),
      },
      {
        path: "cutting",
        element: (
          <OrdersPage
            key="cutting"
            filterBy={["cutting"]}
            emptyText="Тут немає позицій в розкрої."
            actions={{ shelf: true, cutToSew: true }}
          />
        ),
      },
      {
        path: "in-progress",
        element: (
          <OrdersPage
            key="in-progress"
            filterBy={["in-progress"]}
            emptyText="Немає активних замовлень."
            actions={{ complete: true }}
          />
        ),
      },
      {
        path: "done",
        element: <ArchivePage key="done" />,
      },
      {
        path: "analytics",
        element: <Suspense fallback={<div className="muted" style={{ padding: 24 }}>Завантажую аналітику...</div>}><AnalyticsPage key="analytics" /></Suspense>,
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
);
