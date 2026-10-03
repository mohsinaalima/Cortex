import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check, FolderOpen, MessageCircle, Plus, Sparkles, UserRound, X } from "lucide-react";
import "./OnboardingTour.css";

const steps = [
  { id: "home", view: "home", title: "Welcome to your space", text: "Your home gathers recent sources, useful shortcuts, and the threads you’re building.", icon: Sparkles },
  { id: "chat", view: "chat", title: "Think things through", text: "Ask Cortex questions about everything you’ve collected, or open a source to keep a conversation connected to it.", icon: MessageCircle },
  { id: "library", view: "library", title: "Your ideas, connected", text: "Browse images, documents, links, and conversations. Open a source to see its notes and linked thread.", icon: FolderOpen },
  { id: "add", view: "library", title: "Bring something in", text: "Add a document, image, or web link. Cortex turns it into a source you can explore and chat about.", icon: Plus },
  { id: "profile", view: "profile", title: "Make it yours", text: "Open your profile to add a photo and see your personal Cortex space at a glance.", icon: UserRound },
];

export default function OnboardingTour({ onClose, onNavigate, userId }) {
  const [index, setIndex] = useState(0);
  const [geometry, setGeometry] = useState(null);
  const step = steps[index];
  const Icon = step.icon;

  useEffect(() => {
    onNavigate(step.view);
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-tour="${step.id}"]`);
      if (!target) return;
      target.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
      const rect = target.getBoundingClientRect();
      setGeometry({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [index, onNavigate, step]);

  useEffect(() => {
    const update = () => {
      const target = document.querySelector(`[data-tour="${step.id}"]`);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setGeometry({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [step]);

  useEffect(() => {
    const handleKeys = (event) => {
      if (event.key === "ArrowRight" || event.key === "Enter") {
        if (index >= steps.length - 1) {
          localStorage.setItem(`cortex_tour_completed_${userId}`, "true");
          onClose();
        } else setIndex((current) => current + 1);
      }
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
      if (event.key === "Escape") {
        localStorage.setItem(`cortex_tour_completed_${userId}`, "true");
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [index, onClose, userId]);

  function finish() {
    localStorage.setItem(`cortex_tour_completed_${userId}`, "true");
    onClose();
  }
  function move(delta) {
    const next = index + delta;
    if (next < 0) return;
    if (next >= steps.length) finish();
    else setIndex(next);
  }

  const cardWidth = Math.min(340, window.innerWidth - 36);
  let left = (window.innerWidth - cardWidth) / 2;
  let top = Math.max(24, (window.innerHeight - 240) / 2);
  if (geometry) {
    left = Math.min(window.innerWidth - cardWidth - 18, Math.max(18, geometry.cx - cardWidth / 2));
    top = geometry.cy < window.innerHeight * 0.48
      ? Math.min(window.innerHeight - 250, geometry.y + geometry.height + 22)
      : Math.max(18, geometry.y - 246);
  }

  return <div className="tour-layer" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    {geometry && <><div className={`tour-scrim ${geometry ? "" : "tour-scrim-loading"}`}/><div className="tour-spotlight" style={{ left: geometry.x - 7, top: geometry.y - 7, width: geometry.width + 14, height: geometry.height + 14 }}/><svg className="tour-arrow" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`} preserveAspectRatio="none" aria-hidden="true"><defs><marker id="tour-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#6f9674"/></marker></defs><path d={`M ${left + cardWidth / 2} ${top + (geometry.cy < top ? 0 : 4)} Q ${left + cardWidth / 2} ${(top + geometry.cy) / 2} ${geometry.cx} ${geometry.cy + (geometry.cy < top ? 10 : -10)}`} fill="none" stroke="#7fa681" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#tour-arrowhead)"/></svg></>}
    {!geometry && <div className={`tour-scrim ${geometry ? "" : "tour-scrim-loading"}`}/>}
    <section className="tour-card" style={{ left, top }}>
      <button className="tour-close" onClick={finish} aria-label="Skip tutorial"><X size={16}/></button>
      <div className="tour-icon"><Icon size={21}/></div>
      <div className="tour-progress"><span>YOUR CORTEX TOUR</span><strong>{String(index + 1).padStart(2, "0")} <i>/ {String(steps.length).padStart(2, "0")}</i></strong></div>
      <h2 id="tour-title">{step.title}</h2><p>{step.text}</p>
      <div className="tour-progress-track"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }}/></div>
      <footer><button className="tour-skip" onClick={finish}>Skip tour</button><div className="tour-controls">{index > 0 && <button className="tour-back" onClick={() => move(-1)} aria-label="Previous step"><ArrowLeft size={15}/></button>}<button className="tour-next" onClick={() => move(1)}>{index === steps.length - 1 ? <>Finish <Check size={15}/></> : <>Next <ArrowRight size={15}/></>}</button></div></footer>
      <span className="tour-spark"><ArrowDown size={12}/></span>
    </section>
  </div>;
}


