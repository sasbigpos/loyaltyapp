import { useState, useEffect, useRef, useCallback } from "react";

// ─── FIREBASE SETUP ──────────────────────────────────────────────────────────
let _subscribeToKey = null;
async function getSubscriber() {
  if (_subscribeToKey) return _subscribeToKey;
  try { const m = await import('./firebase.js'); _subscribeToKey = m.subscribeToKey; }
  catch { _subscribeToKey = null; }
  return _subscribeToKey;
}

// ─── STORAGE KEYS ────────────────────────────────────────────────────────────
const KEYS = { 
  members: "lc:members", 
  tiers: "lc:tiers", 
  refLevels: "lc:refLevels", 
  merchants: "lc:merchants" 
};

const DEFAULT_TIERS = [
  { id: "bronze", name: "Bronze", minPoints: 0, color: "#cd7f32", bg: "#2a1a0e", icon: "🥉", multiplier: 1.0 },
  { id: "silver", name: "Silver", minPoints: 500, color: "#c0c0c0", bg: "#1a1a1a", icon: "🥈", multiplier: 1.25 },
  { id: "gold", name: "Gold", minPoints: 1500, color: "#ffd700", bg: "#1a1500", icon: "🥇", multiplier: 1.5 },
  { id: "platinum", name: "Platinum", minPoints: 5000, color: "#e5e4e2", bg: "#0f1520", icon: "💎", multiplier: 2.0 },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtPhone = v => v.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d{0,4})(\d{0,4})/, (_, a, b, c) => c ? `${a}-${b}-${c}` : b ? `${a}-${b}` : a);
const getTier = (pts, tiers) => [...tiers].reverse().find(t => pts >= t.minPoints) || tiers[0];
const today = () => new Date().toLocaleDateString("en-MY", { day: "2-digit", month: "short" });
const genId = () => Math.random().toString(36).slice(2, 9);

function getAncestors(members, memberId, maxDepth) {
  const r = []; let cur = memberId; let d = 0;
  while (d < maxDepth) {
    const m = members.find(x => x.id === cur);
    if (!m || !m.referredBy) break;
    d++;
    cur = m.referredBy;
    r.push({ id: cur, level: d });
  }
  return r;
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function MerchantApp() {
  const [members, setMembers] = useState([]);
  const [tiers, setTiers] = useState(DEFAULT_TIERS);
  const [refLevels, setRefLevels] = useState([]);
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Merchant authentication
  const [merchantCode, setMerchantCode] = useState("");
  const [merchantPass, setMerchantPass] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [merchantData, setMerchantData] = useState(null);

  // Award form
  const [phoneInput, setPhoneInput] = useState("");
  const [pointsInput, setPointsInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [selectedMember, setSelectedMember] = useState(null);
  const [isAwarding, setIsAwarding] = useState(false);
  const [toast, setToast] = useState(null);

  // Recent awards
  const [recentAwards, setRecentAwards] = useState([]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let unsubs = [];

    const bootstrap = async () => {
      try {
        const [mr, tr, rr, mchR] = await Promise.all([
          window.storage.get(KEYS.members, true).catch(() => null),
          window.storage.get(KEYS.tiers, true).catch(() => null),
          window.storage.get(KEYS.refLevels, true).catch(() => null),
          window.storage.get(KEYS.merchants, true).catch(() => null),
        ]);

        setMembers(mr ? JSON.parse(mr.value) : []);
        if (tr) setTiers(JSON.parse(tr.value));
        if (rr) setRefLevels(JSON.parse(rr.value));
        if (mchR) setMerchants(JSON.parse(mchR.value));

        // Check for merchant code in URL
        const urlParams = new URLSearchParams(window.location.search);
        const mc = urlParams.get("mc");
        if (mc) {
          setMerchantCode(mc);
        }
      } catch (e) {
        console.error("Load error:", e);
      }
      setLoading(false);

      // Subscribe to real-time updates
      const sub = await getSubscriber();
      if (sub) {
        unsubs = [
          sub(KEYS.members, v => { setMembers(JSON.parse(v)); setSyncing(false); }),
          sub(KEYS.tiers, v => setTiers(JSON.parse(v))),
          sub(KEYS.refLevels, v => setRefLevels(JSON.parse(v))),
          sub(KEYS.merchants, v => setMerchants(JSON.parse(v))),
        ];
      }
    };

    bootstrap();
    return () => unsubs.forEach(fn => fn && fn());
  }, []);

  // ── Merchant login ─────────────────────────────────────────────────────────
  const handleLogin = () => {
    setAuthError("");
    const merchant = merchants.find(m => m.code === merchantCode.toUpperCase() && m.active !== false);
    
    if (!merchant) {
      setAuthError("Merchant not found or inactive.");
      return;
    }

    // Simple password check - merchant code itself is the password
    if (merchantPass !== merchant.code) {
      setAuthError("Invalid password. Try using the merchant code as password.");
      return;
    }

    setMerchantData(merchant);
    setAuthenticated(true);
    showToast(`Welcome, ${merchant.name}!`);
  };

  // ── Find member by phone ──────────────────────────────────────────────────
  const findMember = () => {
    const raw = phoneInput.replace(/\D/g, "");
    if (raw.length < 10) {
      showToast("Please enter a valid phone number (min 10 digits).", "error");
      return;
    }

    const member = members.find(m => m.phone.replace(/\D/g, "") === raw);
    if (!member) {
      showToast("Member not found. Please check the phone number.", "error");
      setSelectedMember(null);
      return;
    }

    setSelectedMember(member);
    showToast(`Member found: ${member.name} (${member.points.toLocaleString()} pts)`);
  };

  // ── Award points ──────────────────────────────────────────────────────────
  const awardPoints = async () => {
    if (!selectedMember) {
      showToast("Please find a member first.", "error");
      return;
    }

    const pts = parseInt(pointsInput);
    if (!pts || pts <= 0) {
      showToast("Please enter a valid positive number of points.", "error");
      return;
    }

    if (!merchantData) {
      showToast("Merchant not authenticated.", "error");
      return;
    }

    setIsAwarding(true);
    try {
      const tier = getTier(selectedMember.points, tiers);
      const effectivePts = Math.round(pts * tier.multiplier);
      const note = noteInput.trim() || `Awarded via ${merchantData.name}`;

      // Update member with new points
      const updatedMembers = members.map(m => {
        if (m.id === selectedMember.id) {
          return {
            ...m,
            points: m.points + effectivePts,
            transactions: [{
              id: genId(),
              pts: effectivePts,
              icon: "◆",
              label: note,
              date: today(),
              type: "earn",
              merchantCode: merchantData.code,
            }, ...(m.transactions || [])]
          };
        }
        return m;
      });

      // Also add referral overrides
      const ancs = getAncestors(members, selectedMember.id, refLevels.length);
      const overrideMap = {};
      ancs.forEach(a => {
        const rl = refLevels.find(r => r.level === a.level);
        if (rl) {
          overrideMap[a.id] = (overrideMap[a.id] || 0) + Math.round(effectivePts * rl.overridePercent / 100);
        }
      });

      const finalMembers = updatedMembers.map(m => {
        if (overrideMap[m.id]) {
          return {
            ...m,
            points: m.points + overrideMap[m.id],
            transactions: [{
              id: genId(),
              pts: overrideMap[m.id],
              icon: "◈",
              label: `Override from ${selectedMember.name}`,
              date: today(),
              type: "earn",
              merchantCode: merchantData.code,
            }, ...(m.transactions || [])]
          };
        }
        return m;
      });

      // Save to Firebase
      await window.storage.set(KEYS.members, JSON.stringify(finalMembers), true);
      
      // Update local state
      setMembers(finalMembers);
      
      // Record recent award
      setRecentAwards(prev => [{
        memberName: selectedMember.name,
        points: effectivePts,
        basePoints: pts,
        merchant: merchantData.name,
        time: new Date().toLocaleString(),
        tier: tier.name,
      }, ...prev].slice(0, 10));

      showToast(`✅ ${effectivePts.toLocaleString()} pts awarded to ${selectedMember.name} (${pts} base × ${tier.multiplier}x tier multiplier)`);
      
      // Reset form
      setPointsInput("");
      setNoteInput("");
      setSelectedMember(null);
      setPhoneInput("");

    } catch (error) {
      console.error("Award error:", error);
      showToast("Failed to award points. Please try again.", "error");
    }
    setIsAwarding(false);
  };

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = () => {
    setAuthenticated(false);
    setMerchantData(null);
    setMerchantCode("");
    setMerchantPass("");
    setSelectedMember(null);
    setRecentAwards([]);
    showToast("Logged out successfully.");
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#080c12", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 900, color: "#10b981", marginBottom: 16 }}>B LOYALTY</div>
          <div style={{ width: 32, height: 32, border: "3px solid #1e2535", borderTop: "3px solid #f59e0b", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <div style={{ color: "#445566", fontSize: 13, marginTop: 16 }}>Loading merchant portal…</div>
        </div>
      </div>
    );
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div style={{ minHeight: "100vh", background: "#080c12", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Playfair+Display:wght@700;900&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          @keyframes fadeUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
          .fu { animation: fadeUp .4s ease both }
          @keyframes spin { to { transform: rotate(360deg) } }
        `}</style>

        <div className="fu" style={{ width: "100%", maxWidth: 420 }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 36, fontWeight: 900, color: "#10b981", letterSpacing: -1 }}>B LOYALTY</div>
            <div style={{ fontSize: 11, color: "#2a3a4a", letterSpacing: 3, textTransform: "uppercase", marginTop: 6 }}>Merchant Portal</div>
          </div>

          <div style={{ background: "#0e1420", border: "1px solid #1e2535", borderRadius: 20, padding: "32px 28px" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e8eaf0", marginBottom: 6 }}>Merchant Sign In</div>
            <div style={{ fontSize: 13, color: "#445566", marginBottom: 28 }}>Enter your merchant code and password</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6677aa", letterSpacing: .8, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Merchant Code</label>
              <input
                className="inp"
                placeholder="e.g. KM01"
                value={merchantCode}
                onChange={e => setMerchantCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{
                  width: "100%", background: "#0a0f1a", border: "1px solid #1e2535", borderRadius: 10,
                  color: "#e8eaf0", padding: "12px 14px", fontSize: 14, fontFamily: "'DM Sans',sans-serif",
                  outline: "none", textTransform: "uppercase", letterSpacing: 2
                }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6677aa", letterSpacing: .8, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Password</label>
              <input
                className="inp"
                type="password"
                placeholder="Enter your merchant password"
                value={merchantPass}
                onChange={e => setMerchantPass(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{
                  width: "100%", background: "#0a0f1a", border: "1px solid #1e2535", borderRadius: 10,
                  color: "#e8eaf0", padding: "12px 14px", fontSize: 14, fontFamily: "'DM Sans',sans-serif",
                  outline: "none"
                }}
              />
              <div style={{ fontSize: 11, color: "#2a3a4a", marginTop: 6 }}>Default password: <span style={{ color: "#f59e0b" }}>same as merchant code</span></div>
            </div>

            {authError && (
              <div style={{ color: "#f87171", fontSize: 13, marginBottom: 16, background: "#2a0d0d", border: "1px solid #5a1a1a", borderRadius: 8, padding: "10px 14px" }}>
                {authError}
              </div>
            )}

            <button
              onClick={handleLogin}
              style={{
                width: "100%", padding: "13px", background: "linear-gradient(135deg, #10b981, #059669)",
                borderRadius: 10, fontSize: 14, fontWeight: 700, color: "#fff",
                fontFamily: "'DM Sans',sans-serif", cursor: "pointer", border: "none",
                letterSpacing: .3, boxShadow: "0 4px 16px #10b98133"
              }}
            >
              Access Merchant Portal →
            </button>

            <div style={{ marginTop: 16, fontSize: 11, color: "#2a3a4a", textAlign: "center" }}>
              <span style={{ color: "#10b981" }}>✓</span> Award points to members · Real-time sync
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN MERCHANT DASHBOARD ──────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#080c12", color: "#e8eaf0", fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select { outline: none; }
        button { cursor: pointer; border: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        .card { background: #0e1420; border: 1px solid #1e2535; border-radius: 16px; }
        .btn { background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-weight: 700; border-radius: 10px; padding: 12px 24px; font-size: 14px; transition: all .2s; letter-spacing: .3px; font-family: 'DM Sans', sans-serif; }
        .btn:hover { opacity: .9; transform: translateY(-1px); box-shadow: 0 4px 16px #10b98144; }
        .btn-secondary { background: linear-gradient(135deg, #f59e0b, #f97316); color: #000; }
        .btn-secondary:hover { box-shadow: 0 4px 16px #f59e0b44; }
        .btn-danger { background: #2a1010; color: #ff6b6b; border: 1px solid #3a1515; }
        .btn-danger:hover { background: #3a1515; }
        .inp { background: #0a0f1a; border: 1px solid #1e2535; border-radius: 10px; color: #e8eaf0; padding: 11px 14px; font-size: 14px; font-family: 'DM Sans', sans-serif; width: 100%; transition: border-color .2s; }
        .inp:focus { border-color: #10b98166; }
        .lbl { font-size: 11px; font-weight: 600; color: #6677aa; letter-spacing: .8px; text-transform: uppercase; margin-bottom: 6px; display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(14px) } to { opacity: 1; transform: translateX(0) } }
        @keyframes toastIn { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .4 } }
        @keyframes spin { to { transform: rotate(360deg) } }
        .fi { animation: fadeIn .35s ease both }
        .si { animation: slideIn .28s ease both }
      `}</style>

      {/* ─── HEADER ────────────────────────────────────────────────────────── */}
      <div style={{ background: "#0e1420", borderBottom: "1px solid #1a2030", padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 900, color: "#10b981" }}>B LOYALTY</div>
          <div style={{ fontSize: 9, color: "#2a3a4a", letterSpacing: 2, textTransform: "uppercase" }}>Merchant Portal</div>
          {merchantData && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12, background: "#0d2a1a", border: "1px solid #1a4a2a", borderRadius: 99, padding: "4px 14px" }}>
              <span style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, color: "#10b981" }}>{merchantData.code}</span>
              <span style={{ fontSize: 11, color: "#4a7a4a" }}>{merchantData.name}</span>
            </div>
          )}
        </div>
        <button onClick={logout} className="btn-danger" style={{ padding: "8px 16px", fontSize: 12, borderRadius: 8 }}>
          Logout
        </button>
      </div>

      {/* ─── TOAST ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", top: 80, right: 28, background: toast.type === "success" ? "#0d2a1a" : "#2a0d0d",
          border: `1px solid ${toast.type === "success" ? "#1a5a2a" : "#5a1a1a"}`,
          color: toast.type === "success" ? "#4ade80" : "#f87171",
          padding: "12px 20px", borderRadius: 12, fontSize: 14, fontWeight: 500, zIndex: 9999,
          animation: "toastIn .3s ease", boxShadow: "0 8px 32px #00000066",
          fontFamily: "'DM Sans',sans-serif", maxWidth: 480
        }}>
          {toast.msg}
        </div>
      )}

      {/* ─── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <div style={{ padding: "32px 36px", maxWidth: 900, margin: "0 auto" }}>

        {/* Welcome */}
        <div className="fi" style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 900, color: "#e8eaf0" }}>
            Award Points
          </h1>
          <p style={{ color: "#5566aa", fontSize: 14, marginTop: 4 }}>
            {merchantData ? `Logged in as ${merchantData.name}` : "Find and reward your members"}
          </p>
        </div>

        {/* ─── AWARD FORM ──────────────────────────────────────────────────── */}
        <div className="card" style={{ padding: "28px 30px", marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

            {/* Left column: Member lookup */}
            <div>
              <label className="lbl">Member Phone Number</label>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  className="inp"
                  placeholder="012-3456-789"
                  value={phoneInput}
                  onChange={e => setPhoneInput(fmtPhone(e.target.value))}
                  onKeyDown={e => e.key === "Enter" && findMember()}
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={findMember} style={{ whiteSpace: "nowrap", padding: "11px 18px" }}>
                  Find
                </button>
              </div>

              {/* Selected member display */}
              {selectedMember && (
                <div style={{
                  marginTop: 14, background: "#0d2a1a", border: "1px solid #1a4a2a", borderRadius: 12,
                  padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#e8eaf0", fontSize: 15 }}>{selectedMember.name}</div>
                    <div style={{ color: "#4a7a4a", fontSize: 12, marginTop: 2 }}>{selectedMember.phone}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#f59e0b" }}>{selectedMember.points.toLocaleString()} pts</div>
                    <div style={{ fontSize: 10, color: getTier(selectedMember.points, tiers).color, fontWeight: 700 }}>
                      {getTier(selectedMember.points, tiers).icon} {getTier(selectedMember.points, tiers).name}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right column: Points input */}
            <div>
              <label className="lbl">Points to Award</label>
              <input
                className="inp"
                type="number"
                min="1"
                placeholder="Enter points (e.g. 100)"
                value={pointsInput}
                onChange={e => setPointsInput(e.target.value)}
                disabled={!selectedMember}
                style={{ opacity: selectedMember ? 1 : 0.5 }}
              />

              {selectedMember && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#4a7a4a" }}>
                  Tier multiplier: <span style={{ color: "#f59e0b", fontWeight: 700 }}>×{getTier(selectedMember.points, tiers).multiplier}</span>
                  {pointsInput && parseInt(pointsInput) > 0 && (
                    <span style={{ marginLeft: 12 }}>
                      → <span style={{ color: "#4ade80", fontWeight: 700 }}>
                        {Math.round(parseInt(pointsInput) * getTier(selectedMember.points, tiers).multiplier).toLocaleString()} pts
                      </span> effective
                    </span>
                  )}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <label className="lbl">Note <span style={{ color: "#2a3a55", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
                <input
                  className="inp"
                  placeholder="e.g. Purchase, Reward, Bonus"
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  disabled={!selectedMember}
                  style={{ opacity: selectedMember ? 1 : 0.5 }}
                />
              </div>
            </div>
          </div>

          {/* Award button */}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #1a2030" }}>
            <button
              className="btn btn-secondary"
              onClick={awardPoints}
              disabled={!selectedMember || !pointsInput || isAwarding}
              style={{
                width: "100%", padding: "14px", fontSize: 15,
                opacity: (!selectedMember || !pointsInput || isAwarding) ? 0.5 : 1
              }}
            >
              {isAwarding ? "⏳ Awarding..." : `✦ Award Points${selectedMember ? ` to ${selectedMember.name}` : ""}`}
            </button>
            {selectedMember && pointsInput && parseInt(pointsInput) > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#445566", textAlign: "center" }}>
                {Math.round(parseInt(pointsInput) * getTier(selectedMember.points, tiers).multiplier).toLocaleString()} pts will be added
                {refLevels.length > 0 && " · Referral overrides will be applied"}
              </div>
            )}
          </div>
        </div>

        {/* ─── RECENT AWARDS ──────────────────────────────────────────────── */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: "#ccd", fontSize: 15 }}>Recent Awards</div>
            <span style={{ fontSize: 11, color: "#445566" }}>{recentAwards.length} awards</span>
          </div>

          {recentAwards.length === 0 ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "#2a3a55", fontSize: 13 }}>
              No recent awards. Start by awarding points to a member!
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentAwards.map((award, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 14px", background: "#0a0f1a", borderRadius: 10,
                  border: "1px solid #1e2535"
                }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "#ccd", fontSize: 13 }}>{award.memberName}</div>
                    <div style={{ fontSize: 11, color: "#445566" }}>{award.merchant} · {award.time}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, color: "#4ade80", fontSize: 14 }}>+{award.points.toLocaleString()} pts</div>
                    <div style={{ fontSize: 10, color: "#445566" }}>{award.tier} · {award.basePoints} base pts</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── STATS ────────────────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 24 }}>
          <div className="card" style={{ padding: "18px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>{members.length}</div>
            <div style={{ fontSize: 11, color: "#445566", marginTop: 4 }}>Total Members</div>
          </div>
          <div className="card" style={{ padding: "18px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b" }}>
              {members.reduce((sum, m) => sum + m.points, 0).toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#445566", marginTop: 4 }}>Total Points Issued</div>
          </div>
          <div className="card" style={{ padding: "18px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#60a5fa" }}>
              {members.filter(m => m.merchantCode === merchantData?.code).length}
            </div>
            <div style={{ fontSize: 11, color: "#445566", marginTop: 4 }}>Members Registered Here</div>
          </div>
        </div>
      </div>
    </div>
  );
}