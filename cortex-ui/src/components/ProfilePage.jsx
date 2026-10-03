import { useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Camera, Database, Fingerprint, FolderOpen, LogOut, Mail, MessageCircle, ShieldCheck, UserRound } from "lucide-react";
import "./ProfilePage.css";
import "./ProfileAvatar.css";

export default function ProfilePage({ user, sourceCount, threadCount, onBack, onLogout, onAvatarChange }) {
  const initial = user?.name?.trim()?.[0]?.toUpperCase() || "U";
  const fileInput = useRef(null);
  const [avatarError, setAvatarError] = useState("");
  async function chooseAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarError("");
    try { await onAvatarChange(file); }
    catch (error) { setAvatarError(error.response?.data?.detail || "Could not update your photo. Try another image."); }
    finally { event.target.value = ""; }
  }
  return <section className="profile-page">
    <div className="profile-heading"><button className="profile-back" onClick={onBack}><ArrowLeft size={15}/> Back to Cortex</button><span className="eyebrow muted">YOUR ACCOUNT</span><h1>Profile & space</h1><p>Your Cortex identity and a little overview of what you’ve gathered.</p></div>
    <div className="profile-layout">
      <article className="profile-card">
        <div className="profile-cover"><div className="profile-cover-orbit cover-orbit-one"/><div className="profile-cover-orbit cover-orbit-two"/><span className="profile-cover-spark spark-one"/><span className="profile-cover-spark spark-two"/><span className="profile-cover-spark spark-three"/></div>
        <div className="profile-identity"><button type="button" className="profile-avatar" onClick={() => fileInput.current?.click()} aria-label="Change profile photo" title="Change profile photo">{user?.avatar_data ? <img src={user.avatar_data} alt="Your profile"/> : initial}<span className="avatar-camera"><Camera size={13}/></span></button><input ref={fileInput} className="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar}/><span className="profile-tag"><Fingerprint size={12}/> CORTEX MEMBER</span><h2>{user?.name || "Cortex member"}</h2><div className="profile-email"><Mail size={14}/>{user?.email}</div>{avatarError&&<p className="avatar-error" role="alert">{avatarError}</p>}</div>
        <div className="profile-divider"/><div className="profile-details"><div><span className="profile-detail-icon"><UserRound size={15}/></span><span><small>DISPLAY NAME</small><strong>{user?.name || "—"}</strong></span></div><div><span className="profile-detail-icon"><Mail size={15}/></span><span><small>EMAIL ADDRESS</small><strong>{user?.email || "—"}</strong></span></div></div>
        <div className="profile-note"><ShieldCheck size={15}/><span>Your space is private to this account. Your sources and conversations are kept together here.</span></div>
      </article>
      <aside className="profile-aside"><span className="eyebrow muted">A SPACE OF YOUR OWN</span><h3>Your Cortex, at a glance</h3><p>Everything you collect and explore lives in your personal knowledge space.</p><div className="profile-stats"><div className="profile-stat"><span className="profile-stat-icon sources"><FolderOpen size={17}/></span><span><strong>{sourceCount}</strong><small>SOURCES</small></span><ArrowUpRight size={14}/></div><div className="profile-stat"><span className="profile-stat-icon threads"><MessageCircle size={17}/></span><span><strong>{threadCount}</strong><small>THREADS</small></span><ArrowUpRight size={14}/></div></div><div className="profile-storage"><span className="storage-icon"><Database size={15}/></span><div><strong>Private by default</strong><small>Your knowledge space is tied to your account.</small></div><span className="storage-dot"/></div><button className="profile-logout" onClick={onLogout}><LogOut size={15}/> Sign out of Cortex</button></aside>
    </div>
  </section>;
}
