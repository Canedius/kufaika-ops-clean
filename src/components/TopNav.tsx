import { NavLink } from "react-router-dom";
import { Flame, Clock, CheckCircle } from "lucide-react";

const links = [
  { to: "/incoming", label: "Замовлення на пошив", icon: Flame, tone: "red" },
  { to: "/in-progress", label: "Взято в роботу", icon: Clock, tone: "amber" },
  { to: "/done", label: "Виготовлено", icon: CheckCircle, tone: "green" },
];

export const TopNav = () => (
  <header className="topnav">
    <div className="brand">
      <img src={`${import.meta.env.BASE_URL}logo.webp`} alt="Kufaika" className="brand-logo" />
    </div>
    <nav>
      {links.map(({ to, label, icon: Icon, tone }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `nav-link nav-${tone}${isActive ? " active" : ""}${tone === "red" && isActive ? " flame-active" : ""}`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  </header>
);
