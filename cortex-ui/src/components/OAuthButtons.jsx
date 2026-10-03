import "./OAuthButtons.css";

const API_BASE = "http://127.0.0.1:8000";

export default function OAuthButtons() {
  function start(provider) {
    window.location.assign(`${API_BASE}/auth/oauth/${provider}/start`);
  }

  return <div className="oauth-provider-list">
    <button type="button" className="oauth-provider" onClick={()=>start("google")}><span className="google-mark">G</span><span>Continue with Google</span></button>
  </div>;
}
