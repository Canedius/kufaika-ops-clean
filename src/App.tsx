import { Outlet } from "react-router-dom";
import { TopNav } from "./components/TopNav";
import { BackToTop } from "./components/BackToTop";

export default function App() {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="page">
        <Outlet />
      </main>
      <BackToTop />
    </div>
  );
}
