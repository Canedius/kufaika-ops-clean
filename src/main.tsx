import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import App from "./App";
import "./index.css";
import { OrdersPage } from "./components/OrdersPage";

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
            actions={{ take: true }}
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
            actions={{ backToIncoming: true, complete: true }}
          />
        ),
      },
      {
        path: "done",
        element: (
          <OrdersPage
            key="done"
            filterBy={["done"]}
            emptyText="Тут будуть виготовлені замовлення."
            actions={{}}
          />
        ),
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>,
);
