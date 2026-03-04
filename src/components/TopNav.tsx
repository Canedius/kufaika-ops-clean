import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Flame, Clock, CheckCircle, Scissors, Layers } from "lucide-react";
import { StockDrawer } from "./StockDrawer";

const links = [
  { to: "/incoming", label: "Замовлення на пошив", icon: Flame, flame: true, colorClass: "" },
  { to: "/cutting", label: "В розкрої", icon: Scissors, flame: false, colorClass: "nav-orange" },
  { to: "/in-progress", label: "Взято в роботу", icon: Clock, flame: false, colorClass: "nav-amber" },
  { to: "/done", label: "Виготовлено", icon: CheckCircle, flame: false, colorClass: "nav-green" },
];

export const TopNav = () => {
  const [stockOpen, setStockOpen] = useState(false);

  return (
    <header className="topnav">
      <div className="brand">
        <img src="/logo.webp" alt="Kufaika" className="brand-logo" />
      </div>
      <nav>
        {links.map(({ to, label, icon: Icon, flame, colorClass }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `nav-link${colorClass ? ` ${colorClass}` : ""}${isActive ? " active" : ""}${flame && isActive ? " flame-active" : ""}`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
        <button
          className={`nav-stock-btn${stockOpen ? " nav-stock-btn--active" : ""}`}
          onClick={() => setStockOpen((v) => !v)}
        >
          <Layers size={18} />
          Крої
        </button>
      </nav>
      <StockDrawer open={stockOpen} onClose={() => setStockOpen(false)} />
    </header>
  );
};
