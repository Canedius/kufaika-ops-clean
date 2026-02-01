import { ArrowUp } from "lucide-react";

export const BackToTop = () => (
  <button
    className="back-to-top"
    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    aria-label="Повернутися нагору"
  >
    <ArrowUp size={18} />
  </button>
);
