import { useState } from "react";
import axios from "axios";
import { ArrowRight, BrainCircuit, Eye, EyeOff, FileText, Image as ImageIcon, Link, LoaderCircle, LockKeyhole, Mail, MessageCircle, Sparkles } from "lucide-react";
import "./AuthPage.css";

const API_BASE = "http://127.0.0.1:8000";

export default function AuthPage({ initialMode = "register", onAuthenticated, onBack }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode === "register";

  async function submit(e) {
    e.preventDefault();
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      const endpoint = isRegister ? "register" : "login";
      const payload = isRegister ? { name: name.trim(), email: email.trim(), password } : { email: email.trim(), password };
      const response = await axios.post(`${API_BASE}/auth/${endpoint}`, payload);
      onAuthenticated(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "We couldn’t reach Cortex. Check the backend and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="auth-shell">
    <section className="auth-story">
      <div className="auth-brand"><span><BrainCircuit size={20}/></span><strong>Cortex</strong></div>
      <div className="auth-story-copy"><span className="auth-eyebrow"><Sparkles size={13}/> YOUR SECOND BRAIN, IN MOTION</span><h1>Make space<br/>for <em>what matters.</em></h1><p>Keep the ideas you find. Follow the connections you didn’t expect.</p>
        <div className="auth-constellation" aria-hidden="true"><span className="auth-orbit orbit-a"/><span className="auth-orbit orbit-b"/><span className="auth-orbit orbit-c"/><span className="auth-node node-center"><BrainCircuit size={21}/></span><span className="auth-node node-photo"><ImageIcon size={16}/></span><span className="auth-node node-note"><FileText size={16}/></span><span className="auth-node node-chat"><MessageCircle size={16}/></span><span className="auth-node node-link"><Link size={15}/></span><i className="auth-star star-a"/><i className="auth-star star-b"/><i className="auth-star star-c"/></div>
      </div>
      <div className="auth-story-footer"><span className="auth-footer-avatar">C</span><span>Every thought has somewhere to go.</span><span className="auth-footer-line"/></div>
    </section>

    <section className="auth-form-side"><div className="auth-form-wrap">
      <button type="button" className="auth-back" onClick={onBack}><span>←</span> Back to Cortex</button>
      <div className="auth-mobile-brand"><span><BrainCircuit size={18}/></span><strong>Cortex</strong></div>
      <div className="auth-heading"><span className="auth-small-label">A PLACE FOR YOUR CURIOSITY</span><h2>{isRegister ? "Start your space." : "Welcome back."}</h2><p>{isRegister ? "Sign up and let your ideas find each other." : "Pick up where your thinking left off."}</p></div>
      <div className="auth-tabs" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected={isRegister} className={isRegister ? "active" : ""} onClick={()=>{setMode("register");setError("");}}>Create account</button><button type="button" role="tab" aria-selected={!isRegister} className={!isRegister ? "active" : ""} onClick={()=>{setMode("login");setError("");}}>Sign in</button></div>
      <form className="auth-form" onSubmit={submit}>
        {isRegister && <label className="auth-field"><span>Your name</span><div className="auth-input"><span className="field-monogram">{name.trim()?.[0]?.toUpperCase() || "✳"}</span><input type="text" name="name" value={name} onChange={e=>setName(e.target.value)} placeholder="How should Cortex address you?" autoComplete="name" maxLength={80} required/></div></label>}
        <label className="auth-field"><span>Email address</span><div className="auth-input"><Mail size={16}/><input type="email" name="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" maxLength={254} required/></div></label>
        <label className="auth-field"><span>Password</span><div className="auth-input"><LockKeyhole size={16}/><input type={showPassword ? "text" : "password"} name="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={isRegister ? "At least 8 characters" : "Enter your password"} autoComplete={isRegister ? "new-password" : "current-password"} minLength={8} maxLength={128} required/><button type="button" className="password-toggle" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>{isRegister&&<small className="field-help">Use at least 8 characters.</small>}</label>
        {error&&<div className="auth-error" role="alert"><span>!</span>{error}</div>}
        <button className="auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? <><LoaderCircle size={17} className="auth-spinner"/> {isRegister ? "Creating your space…" : "Signing you in…"}</> : <>{isRegister ? "Create your account" : "Sign in to Cortex"}<ArrowRight size={16}/></>}</button>
      </form>
      <div className="auth-secure"><span><LockKeyhole size={12}/></span><p>Your notes and conversations stay in your own private space.</p></div>
    </div><div className="auth-legal">Cortex <span>·</span> A quieter place to think</div></section>
  </main>;
}
