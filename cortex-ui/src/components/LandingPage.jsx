import { ArrowDown, ArrowRight, ArrowUpRight, BrainCircuit, FileText, Image as ImageIcon, Link, LockKeyhole, MessageCircle, Network, Sparkles } from "lucide-react";
import "./LandingPage.css";

export default function LandingPage({ onSignUp, onLogin }) {
  return <main className="landing-page">
    <header className="landing-nav">
      <a className="landing-brand" href="#top" aria-label="Cortex home"><span><BrainCircuit size={20}/></span><strong>Cortex</strong></a>
      <nav className="landing-nav-links" aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#your-space">Your space</a></nav>
      <div className="landing-nav-actions"><button className="landing-login" onClick={onLogin}>Log in</button><button className="landing-signup" onClick={onSignUp}>Sign up <ArrowUpRight size={14}/></button></div>
    </header>

    <section className="landing-hero" id="top">
      <div className="landing-hero-copy"><span className="landing-kicker"><i/> A HOME FOR YOUR CURIOSITY</span><h1>Let your ideas<br/>find <em>each other.</em></h1><p>Save the things you learn. Ask better questions. See the threads connecting it all.</p><div className="landing-hero-actions"><button className="landing-primary" onClick={onSignUp}>Create your free space <ArrowRight size={16}/></button><button className="landing-secondary" onClick={onLogin}>I already have an account</button></div><div className="landing-proof"><span className="proof-avatars"><i>C</i><i>✳</i><i>↗</i></span><span>Your thoughts, gathered in one thoughtful place</span></div></div>

      <div className="landing-art" aria-label="A visual map of notes, images, links, and conversations connected together">
        <div className="landing-art-glow"/><div className="landing-grid"/>
        <svg className="landing-connections" viewBox="0 0 560 450" aria-hidden="true"><path d="M116 114 C185 136 206 196 256 221"/><path d="M441 97 C369 129 349 177 303 211"/><path d="M419 344 C356 317 340 270 298 240"/><path d="M106 329 C178 294 208 260 256 236"/><path d="M116 114 C214 58 331 61 441 97"/><path d="M106 329 C214 396 330 402 419 344"/></svg>
        <div className="landing-orbit orbit-outer"/><div className="landing-orbit orbit-middle"/><div className="landing-orbit orbit-inner"/>
        <div className="landing-center"><div className="landing-mascot"><span className="mascot-eye left"/><span className="mascot-eye right"/><span className="mascot-mouth"/><BrainCircuit size={13}/></div><span>CORTEX</span><small>your thinking space</small></div>
        <div className="landing-node landing-note"><span><FileText size={17}/></span><div><b>Reading notes</b><small>Ideas worth keeping</small></div><i/></div>
        <div className="landing-node landing-image"><span><ImageIcon size={17}/></span><div><b>Visual references</b><small>Things you’ve collected</small></div></div>
        <div className="landing-node landing-chat"><span><MessageCircle size={17}/></span><div><b>A good question</b><small>Connected to a source</small></div></div>
        <div className="landing-node landing-link"><span><Link size={16}/></span><div><b>From the web</b><small>A link to explore</small></div></div>
        <span className="landing-spark s-one"/><span className="landing-spark s-two"/><span className="landing-spark s-three"/>
        <div className="landing-art-caption"><Network size={13}/> IDEAS IN ORBIT <span/> ALWAYS CONNECTED</div>
      </div>
      <a className="landing-scroll" href="#how-it-works"><span>SCROLL TO EXPLORE</span><ArrowDown size={13}/></a>
    </section>

    <section className="landing-how" id="how-it-works"><div className="landing-section-intro"><span className="landing-section-kicker">A LITTLE MORE CONNECTED</span><h2>Your second brain,<br/><em>without the busywork.</em></h2><p>Cortex gives all the things you save a place to meet.</p></div><div className="landing-steps"><article><span className="step-icon step-save"><ImageIcon size={18}/></span><span className="step-no">01 / COLLECT</span><h3>Bring in what sparks you.</h3><p>Save a note, document, image, or web link. Cortex reads it and keeps it close.</p></article><article><span className="step-icon step-ask"><Sparkles size={18}/></span><span className="step-no">02 / EXPLORE</span><h3>Ask the questions you have.</h3><p>Chat with one source or your whole library. Answers stay grounded in what you saved.</p></article><article><span className="step-icon step-connect"><Network size={18}/></span><span className="step-no">03 / CONNECT</span><h3>Follow where ideas lead.</h3><p>Conversations stay linked to their sources, so useful connections are easy to find again.</p></article></div></section>

    <section className="landing-cta" id="your-space"><div className="cta-orbit"><span/><span/><span/><BrainCircuit size={26}/></div><div><span className="landing-section-kicker">YOUR SPACE IS WAITING</span><h2>Give your ideas<br/><em>somewhere to grow.</em></h2></div><button className="landing-primary" onClick={onSignUp}>Create your free space <ArrowRight size={16}/></button></section>
    <footer className="landing-footer"><a className="landing-brand" href="#top"><span><BrainCircuit size={17}/></span><strong>Cortex</strong></a><span><LockKeyhole size={12}/> Your space is yours.</span><button onClick={onLogin}>Already joined? Log in <ArrowRight size={13}/></button></footer>
  </main>;
}
