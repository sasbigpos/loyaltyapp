import { useState, useEffect, useRef, useCallback } from "react";
// subscribeToKey is loaded dynamically so App.jsx works in both the Claude
// artifact sandbox (no firebase.js available) and the hosted build.
let _subscribeToKey = null;
async function getSubscriber() {
  if (_subscribeToKey) return _subscribeToKey;
  try { const m = await import('./firebase.js'); _subscribeToKey = m.subscribeToKey; }
  catch { _subscribeToKey = null; }
  return _subscribeToKey;
}

// ─── DEFAULTS ────────────────────────────────────────────────────────────────
const DEFAULT_TIERS = [
  { id:"bronze",   name:"Bronze",   minPoints:0,    color:"#cd7f32", bg:"#2a1a0e", icon:"🥉", multiplier:1.0  },
  { id:"silver",   name:"Silver",   minPoints:500,  color:"#c0c0c0", bg:"#1a1a1a", icon:"🥈", multiplier:1.25 },
  { id:"gold",     name:"Gold",     minPoints:1500, color:"#ffd700", bg:"#1a1500", icon:"🥇", multiplier:1.5  },
  { id:"platinum", name:"Platinum", minPoints:5000, color:"#e5e4e2", bg:"#0f1520", icon:"💎", multiplier:2.0  },
];
const DEFAULT_REF = [
  { level:1, label:"Direct Referral",    overridePercent:10, color:"#f59e0b" },
  { level:2, label:"2nd Level Override", overridePercent:5,  color:"#10b981" },
  { level:3, label:"3rd Level Override", overridePercent:2,  color:"#6366f1" },
];
const SEED_MEMBERS = [];
const SEED_MERCHANTS = [];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const genId    = () => Math.random().toString(36).slice(2,9);
const fmtPhone = v  => v.replace(/\D/g,"").slice(0,11).replace(/(\d{3})(\d{0,4})(\d{0,4})/,(_,a,b,c)=>c?`${a}-${b}-${c}`:b?`${a}-${b}`:a);
const today    = () => new Date().toLocaleDateString("en-MY",{day:"2-digit",month:"short"});
const getTier  = (pts,tiers) => [...tiers].reverse().find(t=>pts>=t.minPoints)||tiers[0];

function getAncestors(members,memberId,maxDepth){
  const r=[];let cur=memberId;let d=0;
  while(d<maxDepth){const m=members.find(x=>x.id===cur);if(!m||!m.referredBy)break;d++;cur=m.referredBy;r.push({id:cur,level:d});}
  return r;
}
// Parse MM-DD birthday into month index (0-based) and display string
function parseBirthday(bday){
  if(!bday) return null;
  const parts=bday.split("-");
  if(parts.length<2) return null;
  const month=parseInt(parts[0])-1; // 0-based month
  const day=parseInt(parts[1]);
  if(isNaN(month)||isNaN(day)) return null;
  return {month,day};
}
function fmtBirthday(bday,format="short"){
  const p=parseBirthday(bday);
  if(!p) return null;
  const MONTHS_L=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTHS_S=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m=format==="long"?MONTHS_L[p.month]:MONTHS_S[p.month];
  return `${p.day} ${m}`;
}

function getDownline(members,rootId,maxDepth){
  const tree={};
  members.forEach(m=>{if(m.referredBy)tree[m.referredBy]=[...(tree[m.referredBy]||[]),m.id];});
  const walk=(id,d)=>{if(d>maxDepth)return[];return(tree[id]||[]).flatMap(cid=>[{id:cid,level:d},...walk(cid,d+1)]);};
  return walk(rootId,1);
}

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────
const KEYS = { members:"lc:members", tiers:"lc:tiers", refLevels:"lc:refLevels", adminPw:"lc:adminPw", waTemplates:"lc:waTemplates", config:"lc:config", rewards:"lc:rewards", merchants:"lc:merchants" };
const DEFAULT_CONFIG = { welcomeEnabled:true, welcomePts:100 };
const DEFAULT_REWARDS = [
  { id:"rw1", name:"Free Dessert",     pts:200,  icon:"🍰", category:"Dining",   active:true },
  { id:"rw2", name:"Room Upgrade",     pts:500,  icon:"🏨", category:"Stay",     active:true },
  { id:"rw3", name:"Spa 30 min",       pts:800,  icon:"💆", category:"Wellness", active:true },
  { id:"rw4", name:"Airport Transfer", pts:1200, icon:"🚗", category:"Travel",   active:true },
  { id:"rw5", name:"Chef's Table",    pts:1500, icon:"🍽️", category:"Dining",   active:true },
  { id:"rw6", name:"Weekend Getaway",  pts:4000, icon:"🌴", category:"Stay",     active:true },
];

async function loadAll() {
  try {
    const [mr,tr,rr] = await Promise.all([
      window.storage.get(KEYS.members,  true).catch(()=>null),
      window.storage.get(KEYS.tiers,    true).catch(()=>null),
      window.storage.get(KEYS.refLevels,true).catch(()=>null),
    ]);
    return {
      members:   mr ? JSON.parse(mr.value) : SEED_MEMBERS,
      tiers:     tr ? JSON.parse(tr.value) : DEFAULT_TIERS,
      refLevels: rr ? JSON.parse(rr.value) : DEFAULT_REF,
    };
  } catch { return { members:SEED_MEMBERS, tiers:DEFAULT_TIERS, refLevels:DEFAULT_REF }; }
}
async function saveMembers(members) { try { await window.storage.set(KEYS.members, JSON.stringify(members), true); } catch(e){console.error(e);} }
async function saveTiers(tiers)     { try { await window.storage.set(KEYS.tiers,   JSON.stringify(tiers),   true); } catch(e){console.error(e);} }
async function saveRefLevels(rl)    { try { await window.storage.set(KEYS.refLevels,JSON.stringify(rl),     true); } catch(e){console.error(e);} }
async function saveMerchants(merchants) { try { await window.storage.set(KEYS.merchants, JSON.stringify(merchants), true); } catch(e){console.error(e);} }

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function AnimNumber({value}){
  const [d,setD]=useState(0);const p=useRef(value);
  useEffect(()=>{const from=p.current;p.current=value;let s=null;
    const step=ts=>{if(!s)s=ts;const pct=Math.min((ts-s)/700,1);const e=1-Math.pow(1-pct,3);setD(Math.round(from+(value-from)*e));if(pct<1)requestAnimationFrame(step);};
    requestAnimationFrame(step);},[value]);
  return <span>{d.toLocaleString()}</span>;
}
function PBar({value,max,color}){
  return <div style={{background:"#ffffff14",borderRadius:99,height:6,overflow:"hidden"}}>
    <div style={{width:`${Math.min((value/Math.max(max,1))*100,100)}%`,height:"100%",background:color,borderRadius:99,transition:"width .8s cubic-bezier(.4,0,.2,1)"}}/>
  </div>;
}
function TierBadge({tier}){
  return <span style={{background:tier.bg||"#111",color:tier.color,border:`1px solid ${tier.color}44`,borderRadius:99,padding:"2px 10px",fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",whiteSpace:"nowrap"}}>{tier.icon} {tier.name}</span>;
}
function SyncDot({syncing}){
  return <div title={syncing?"Syncing…":"Live"} style={{width:8,height:8,borderRadius:"50%",background:syncing?"#f59e0b":"#4ade80",boxShadow:`0 0 6px ${syncing?"#f59e0b":"#4ade80"}`,animation:syncing?"pulse .8s infinite":"none",flexShrink:0}}/>;
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function AdminApp() {
  const [authed,    setAuthed]          = useState(false);
  const [adminPw,   setAdminPw]        = useState(null);
  const [waTemplates,setWaTemplates]   = useState(null);
  const [appConfig,  setAppConfig]     = useState(DEFAULT_CONFIG);
  const [rewards,    setRewards]       = useState(DEFAULT_REWARDS);
  const [merchants,  setMerchants]     = useState([]);
  const [pwReady,   setPwReady]        = useState(false);
  const [members,   setMembersState]   = useState(SEED_MEMBERS);
  const [tiers,     setTiersState]     = useState(DEFAULT_TIERS);
  const [refLevels, setRefState]       = useState(DEFAULT_REF);
  const [view,      setView]           = useState("dashboard");
  const [selId,     setSelId]          = useState(null);
  const [toast,     setToast]          = useState(null);
  const [loading,   setLoading]        = useState(false);
  const [syncing,   setSyncing]        = useState(false);

  const showToast = (msg,type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3000); };

  // ── Load from storage + subscribe ──────────────────────────────────────────
  useEffect(()=>{
    let unsubs = [];
    let done = false;

    // Safety net: always show the app within 2 seconds no matter what
    const safetyTimer = setTimeout(() => {
      if (!done) { done = true; setLoading(false); setPwReady(true); }
    }, 2000);

    const run = async () => {
      try {
        const timeout = (ms) => new Promise(r => setTimeout(r, ms));
        const safeGet = (key) => Promise.race([
          window.storage.get(key, true).catch(()=>null),
          timeout(2000).then(()=>null)
        ]);
        const [mr,tr,rr,pr,wr,cr,rwR,mchR] = await Promise.all([
          safeGet(KEYS.members),
          safeGet(KEYS.tiers),
          safeGet(KEYS.refLevels),
          safeGet(KEYS.adminPw),
          safeGet(KEYS.waTemplates),
          safeGet(KEYS.config),
          safeGet(KEYS.rewards),
          safeGet(KEYS.merchants),
        ]);
        if(pr) setAdminPw(pr.value);
        if(wr) setWaTemplates(JSON.parse(wr.value));
        if(cr) setAppConfig(JSON.parse(cr.value));
        if(rwR) setRewards(JSON.parse(rwR.value));
        if(mchR) setMerchants(JSON.parse(mchR.value));
        setPwReady(true);
        const members   = mr ? JSON.parse(mr.value) : SEED_MEMBERS;
        const tiers     = tr ? JSON.parse(tr.value) : DEFAULT_TIERS;
        const refLevels = rr ? JSON.parse(rr.value) : DEFAULT_REF;
        setMembersState(members);
        setTiersState(tiers);
        setRefState(refLevels);
        // Write defaults in background, never awaited
        if (!mr) window.storage.set(KEYS.members,   JSON.stringify(members),   true).catch(()=>{});
        if (!tr) window.storage.set(KEYS.tiers,     JSON.stringify(tiers),     true).catch(()=>{});
        if (!rr) window.storage.set(KEYS.refLevels, JSON.stringify(refLevels), true).catch(()=>{});
      } catch(e) {
        console.error('Load error:', e);
      }
      if (!done) { done = true; clearTimeout(safetyTimer); setLoading(false); }

      // Subscribe to real-time updates
      try {
        const sub = await getSubscriber();
        if (sub) {
          unsubs = [
            sub(KEYS.members,   v => setMembersState(JSON.parse(v))),
            sub(KEYS.tiers,     v => setTiersState(JSON.parse(v))),
            sub(KEYS.refLevels, v => setRefState(JSON.parse(v))),
          ];
        }
      } catch(e) { console.error('Subscribe error:', e); }
    };

    run();
    return () => { unsubs.forEach(fn => fn && fn()); clearTimeout(safetyTimer); };
  },[]);

  // Persist helpers (write-through)
  const setMembers = useCallback(async(fn)=>{
    setSyncing(true);
    setMembersState(prev=>{const next=typeof fn==="function"?fn(prev):fn;saveMembers(next).finally(()=>setSyncing(false));return next;});
  },[]);
  const setTiers = useCallback(async(fn)=>{
    setSyncing(true);
    setTiersState(prev=>{const next=typeof fn==="function"?fn(prev):fn;saveTiers(next).finally(()=>setSyncing(false));return next;});
  },[]);
  const setRefLevels = useCallback(async(fn)=>{
    setSyncing(true);
    setRefState(prev=>{const next=typeof fn==="function"?fn(prev):fn;saveRefLevels(next).finally(()=>setSyncing(false));return next;});
  },[]);

  // ⭐ FIXED setMerchants to avoid self-reference recursion
  const setMerchants = useCallback(async(fn)=>{
    setSyncing(true);
    setMerchantsState(prev=>{const next=typeof fn==="function"?fn(prev):fn;saveMerchants(next).finally(()=>setSyncing(false));return next;});
  }, []);

  // Award points + cascade referral overrides
  const awardPoints = (memberId, basePts, note, merchantCode="", icon="◆") => {
    setMembers(prev=>{
      const member=prev.find(m=>m.id===memberId); if(!member) return prev;
      const tier=getTier(member.points,tiers);
      const effective=Math.round(basePts*tier.multiplier);
      const ancs=getAncestors(prev,memberId,refLevels.length);
      const overrideMap={};
      ancs.forEach(a=>{const rl=refLevels.find(r=>r.level===a.level);if(rl)overrideMap[a.id]=(overrideMap[a.id]||0)+Math.round(effective*rl.overridePercent/100);});
      return prev.map(m=>{
        if(m.id===memberId) return {...m,points:m.points+effective,transactions:[{id:genId(),pts:effective,icon,label:note,date:today(),type:"earn",merchantCode},...m.transactions]};
        if(overrideMap[m.id]) return {...m,points:m.points+overrideMap[m.id],transactions:[{id:genId(),pts:overrideMap[m.id],icon:"◈",label:`Override: ${member.name}`,date:today(),type:"earn",merchantCode},...m.transactions]};
        return m;
      });
    });
  };

  const enrollMember = (name,phone,referredBy,pin="0000",birthday="",merchantCode="") => {
    const id=genId();
    const code=name.split(" ")[0].toUpperCase()+"-"+Math.floor(1000+Math.random()*9000);
    const welcomeOn=appConfig.welcomeEnabled!==false;
    const welcomePts=welcomeOn?(parseInt(appConfig.welcomePts)||100):0;
    const txns=welcomeOn?[{id:genId(),pts:welcomePts,icon:"⭐",label:"Welcome Bonus",date:today(),type:"earn"}]:[];
    const newM={id,name,phone,pin,birthday,merchantCode,points:welcomePts,referredBy:referredBy||null,joinedAt:new Date().toISOString().slice(0,10),referralCode:code,transactions:txns};
    setMembers(prev=>[...prev,newM]);
    return newM;
  };

  // ─── HARD RESET FUNCTIONS ──────────────────────────────────────────────────

  // Action 1: Reset Only Points and Transactions (Keeps Members, Merchants, Tiers)
  const handleResetPoints = async () => {
    if (!window.confirm("⚠️ This will permanently delete ALL transactions and set ALL member points to 0.\n\nMember profiles (names, phone numbers, merchant assignments, etc.) will be KEPT.\n\nAre you sure you want to continue?")) return;
    if (!window.confirm("Final confirmation: Reset points and transactions for all members?")) return;

    setSyncing(true);
    showToast("Resetting points & transactions... please wait.", "success");
    
    try {
      // Map through current members, set points to 0 and empty the transactions array
      const resetMembers = members.map(m => ({
        ...m,
        points: 0,
        transactions: []
      }));

      // Save the modified list back to Firebase
      await saveMembers(resetMembers);
      setMembersState(resetMembers);

      showToast("✅ All points and transactions have been reset to 0.", "success");
      
      // Reload the page to ensure the UI and cache completely refresh
      setTimeout(() => { window.location.reload(); }, 1500);

    } catch (error) {
      console.error("Reset points error:", error);
      showToast("❌ Failed to reset points. Check console for details.", "error");
      setSyncing(false);
    }
  };

  // Action 2: Delete EVERYTHING (Clean Slate - including Members)
  const handleWipeAll = async () => {
    if (!window.confirm("⚠️ WARNING: This will permanently delete ALL members, merchants, points, transactions, referral levels, and tier settings from the Firebase database.\n\nThis action cannot be undone!\n\nAre you sure you want to continue?")) return;
    if (!window.confirm("Final confirmation: Are you ABSOLUTELY sure you want to wipe all data?")) return;

    setSyncing(true);
    showToast("Wiping all data... please wait.", "success");
    
    try {
      // 1. Reset Tiers to Default
      await saveTiers(DEFAULT_TIERS);
      setTiersState(DEFAULT_TIERS);

      // 2. Reset Referral Levels to Default
      await saveRefLevels(DEFAULT_REF);
      setRefState(DEFAULT_REF);

      // 3. Reset Merchants to Empty
      await saveMerchants([]);
      setMerchants([]);

      // 4. Reset Members to Empty
      await saveMembers([]);
      setMembersState([]);

      showToast("✅ All members, merchants, and points have been permanently wiped.", "success");
      
      // Reload the page to ensure the UI and cache completely refresh from Firebase
      setTimeout(() => { window.location.reload(); }, 1500);

    } catch (error) {
      console.error("Wipe error:", error);
      showToast("❌ Failed to wipe data. Check console for details.", "error");
      setSyncing(false);
    }
  };

  if(!pwReady) return (
    <div style={{minHeight:"100vh",background:"#080c12",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#10b981",WebkitTextFillColor:"#10b981",marginBottom:16}}>B LOYALTY</div>
        <div style={{width:32,height:32,border:"3px solid #1e2535",borderTop:"3px solid #f59e0b",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto"}}/>
      </div>
    </div>
  );
  if(!authed) return <AdminLogin storedPw={adminPw} onAuth={()=>setAuthed(true)}/>;

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#080c12",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#10b981",WebkitTextFillColor:"#10b981",marginBottom:16}}>B LOYALTY</div>
        <div style={{width:32,height:32,border:"3px solid #1e2535",borderTop:"3px solid #f59e0b",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto"}}/>
        <div style={{color:"#445566",fontSize:13,marginTop:16,fontFamily:"'DM Sans',sans-serif"}}>Loading shared data…</div>
      </div>
    </div>
  );

  const ctx={members,tiers,refLevels,setMembers,setTiers,setRefLevels,awardPoints,enrollMember,showToast,adminPw,setAdminPw,waTemplates,setWaTemplates,appConfig,setAppConfig,rewards,setRewards,merchants,setMerchants, handleResetPoints, handleWipeAll };

  return (
    <div style={{minHeight:"100vh",background:"#080c12",color:"#e8eaf0",fontFamily:"'DM Sans','Segoe UI',sans-serif",display:"flex"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;} input,select{outline:none;} button{cursor:pointer;border:none;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-track{background:#0a0a0a;} ::-webkit-scrollbar-thumb{background:#222;border-radius:2px;}
        .card{background:#0e1420;border:1px solid #1e2535;border-radius:16px;}
        .card-h{transition:all .2s;} .card-h:hover{border-color:#2e3a50;transform:translateY(-2px);box-shadow:0 8px 32px #00000055;}
        .btn{background:linear-gradient(135deg,#f59e0b,#f97316);color:#000;font-weight:700;border-radius:10px;padding:10px 20px;font-size:14px;transition:all .2s;letter-spacing:.3px;font-family:'DM Sans',sans-serif;}
        .btn:hover{opacity:.9;transform:translateY(-1px);box-shadow:0 4px 16px #f59e0b44;}
        .btn-g{background:transparent;color:#8899bb;border:1px solid #1e2535;border-radius:10px;padding:9px 18px;font-size:14px;transition:all .2s;font-family:'DM Sans',sans-serif;}
        .btn-g:hover{border-color:#3a4a66;color:#ccd;}
        .btn-d{background:#2a1010;color:#ff6b6b;border:1px solid #3a1515;border-radius:10px;padding:9px 18px;font-size:14px;transition:all .2s;font-family:'DM Sans',sans-serif;}
        .btn-d:hover{background:#3a1515;}
        .btn-danger{background:#1a0a0a;color:#ff6b6b;border:1px solid #4a1a1a;border-radius:10px;padding:9px 18px;font-size:14px;transition:all .2s;font-family:'DM Sans',sans-serif;}
        .btn-danger:hover{background:#2a1010;border-color:#5a1a1a;}
        .inp{background:#0a0f1a;border:1px solid #1e2535;border-radius:10px;color:#e8eaf0;padding:11px 14px;font-size:14px;font-family:'DM Sans',sans-serif;width:100%;transition:border-color .2s;}
        .inp:focus{border-color:#f59e0b66;}
        .lbl{font-size:11px;font-weight:600;color:#6677aa;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;display:block;}
        .nav{padding:10px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s;display:flex;alignItems:"center";gap:9px;color:#6677aa;}
        .nav:hover{background:#0e1420;color:#ccd;}
        .nav.on{background:#1a2035;color:#f59e0b;font-weight:600;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}}
        @keyframes toastIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .fi{animation:fadeIn .35s ease both}
        .si{animation:slideIn .28s ease both}
        tr.row:hover td{background:#0e1420!important;}
      `}</style>

      {/* SIDEBAR */}
      <div style={{width:220,background:"#09101a",borderRight:"1px solid #1a2030",padding:"24px 16px",display:"flex",flexDirection:"column",flexShrink:0,position:"sticky",top:0,height:"100vh",overflowY:"auto"}}>
        <div style={{marginBottom:28}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:"#10b981",WebkitTextFillColor:"#10b981"}}>B LOYALTY</div>
            <SyncDot syncing={syncing}/>
          </div>
          <div style={{fontSize:9,color:"#2a3a4a",letterSpacing:2,textTransform:"uppercase"}}>Admin Portal</div>
        </div>
        {[{id:"dashboard",icon:"◈",label:"Dashboard"},{id:"members",icon:"◉",label:"Members"},{id:"enroll",icon:"⊕",label:"Enroll Member"},{id:"points",icon:"◆",label:"Award Points"},{id:"redeem",icon:"🎁",label:"Redeem Rewards"},{id:"history",icon:"◷",label:"All Transactions"},{id:"merchants",icon:"🏪",label:"Merchants"},{id:"whatsapp",icon:"💬",label:"WhatsApp Blast"},{id:"config",icon:"◎",label:"Configuration"}].map(n=>(
          <div key={n.id} className={`nav${view===n.id?" on":""}`} onClick={()=>{setView(n.id);setSelId(null);}}>
            <span style={{fontSize:16}}>{n.icon}</span>{n.label}
          </div>
        ))}
        <div style={{marginTop:"auto",paddingTop:16,borderTop:"1px solid #1a2030"}}>
          <div style={{fontSize:11,color:"#2a3a4a",textAlign:"center",marginBottom:8}}>{members.length} Members Enrolled</div>
          <div style={{fontSize:10,color:syncing?"#f59e0b":"#2a4a2a",textAlign:"center",fontWeight:600,marginBottom:14}}>{syncing?"⟳ Syncing…":"✓ Data synced"}</div>
          <button onClick={()=>setAuthed(false)} style={{width:"100%",padding:"9px",background:"#1a0e0e",border:"1px solid #3a1a1a",borderRadius:10,color:"#cc6666",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",letterSpacing:.3,transition:"all .2s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#2a1010";e.currentTarget.style.color="#ff8888";}}
            onMouseLeave={e=>{e.currentTarget.style.background="#1a0e0e";e.currentTarget.style.color="#cc6666";}}>
            ⎋ Logout
          </button>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{flex:1,padding:"32px 36px",overflowY:"auto",minHeight:"100vh"}}>
        {view==="dashboard" && <Dashboard ctx={ctx} onSelect={id=>{setSelId(id);setView("profile");}}/>}
        {view==="members"   && <Members   ctx={ctx} onSelect={id=>{setSelId(id);setView("profile");}}/>}
        {view==="enroll"    && <Enroll    ctx={ctx} onDone={()=>setView("members")}/>}
        {view==="points"    && <AwardPts  ctx={ctx}/>}
        {view==="config"    && <Config    ctx={ctx}/>}
        {view==="whatsapp"  && <WhatsAppBlast ctx={ctx}/>}
        {view==="redeem"    && <RedeemRewards ctx={ctx}/>}
        {view==="history"   && <AllTransactions ctx={ctx} onSelect={id=>{setSelId(id);setView("profile");}}/>}
        {view==="merchants"  && <MerchantsPage ctx={ctx}/>}
        {view==="profile"   && selId && <Profile ctx={ctx} memberId={selId} onBack={()=>setView("members")}/>}
      </div>

      {/* TOAST */}
      {toast && <div style={{position:"fixed",bottom:28,right:28,background:toast.type==="success"?"#0d2a1a":"#2a0d0d",border:`1px solid ${toast.type==="success"?"#1a5a2a":"#5a1a1a"}`,color:toast.type==="success"?"#4ade80":"#f87171",padding:"12px 20px",borderRadius:12,fontSize:14,fontWeight:500,zIndex:9999,animation:"toastIn .3s ease",boxShadow:"0 8px 32px #00000066",fontFamily:"'DM Sans',sans-serif"}}>
        {toast.type==="success"?"✓ ":"✕ "}{toast.msg}
      </div>}
    </div>
  );
}


// ─── ADMIN LOGIN ─────────────────────────────────────────────────────────────
function AdminLogin({onAuth,storedPw}){
  const [pw,setPw]=useState("");
  const [err,setErr]=useState("");
  const [show,setShow]=useState(false);
  const ADMIN_PW = storedPw || import.meta.env.VITE_ADMIN_PASSWORD || "admin1234";
  const submit=()=>{
    if(pw===ADMIN_PW){onAuth();}
    else{setErr("Incorrect password. Please try again.");setPw("");}
  };
  return(
    <div style={{minHeight:"100vh",background:"#080c12",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Playfair+Display:wght@700;900&display=swap');*{box-sizing:border-box;margin:0;padding:0;}@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}.fu{animation:fadeUp .4s ease both}`}</style>
      <div className="fu" style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:36,fontWeight:900,color:"#10b981",WebkitTextFillColor:"#10b981",letterSpacing:-1}}>B LOYALTY</div>
          <div style={{fontSize:11,color:"#2a3a4a",letterSpacing:3,textTransform:"uppercase",marginTop:6}}>Admin Portal</div>
        </div>
        <div style={{background:"#0e1420",border:"1px solid #1e2535",borderRadius:20,padding:"32px 28px"}}>
          <div style={{fontSize:20,fontWeight:700,color:"#e8eaf0",marginBottom:6}}>Sign in</div>
          <div style={{fontSize:13,color:"#445566",marginBottom:28}}>Enter the admin password to continue</div>
          <label style={{fontSize:11,fontWeight:600,color:"#6677aa",letterSpacing:.8,textTransform:"uppercase",marginBottom:6,display:"block"}}>Password</label>
          <div style={{position:"relative",marginBottom:err?8:20}}>
            <input type={show?"text":"password"} value={pw} onChange={e=>{setPw(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Enter admin password"
              style={{width:"100%",background:"#0a0f1a",border:`1px solid ${err?"#5a1a1a":"#1e2535"}`,borderRadius:10,color:"#e8eaf0",padding:"12px 44px 12px 14px",fontSize:14,fontFamily:"'DM Sans',sans-serif",outline:"none"}}/>
            <button onClick={()=>setShow(s=>!s)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#445566",cursor:"pointer",fontSize:16,padding:2}}>{show?"🙈":"👁"}</button>
          </div>
          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:16}}>{err}</div>}
          <button onClick={submit} style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#f59e0b,#f97316)",borderRadius:10,fontSize:14,fontWeight:700,color:"#000",fontFamily:"'DM Sans',sans-serif",cursor:"pointer",border:"none",letterSpacing:.3,boxShadow:"0 4px 16px #f59e0b33"}}>Access Admin Portal →</button>
          <div style={{marginTop:16,fontSize:11,color:"#2a3a4a",textAlign:"center"}}>Default password: <span style={{color:"#f59e0b",fontWeight:600}}>admin1234</span> · Change via VITE_ADMIN_PASSWORD in .env.local</div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ctx,onSelect}){
  const {members,tiers}=ctx;
  const totalPts=members.reduce((s,m)=>s+m.points,0);
  const tierCounts=tiers.map(t=>({...t,count:members.filter(m=>getTier(m.points,tiers).id===t.id).length}));
  return <div className="fi">
    <div style={{marginBottom:28}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:30,fontWeight:900,color:"#e8eaf0"}}>Overview</h1>
      <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Changes here sync instantly to the Member Portal</p>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24}}>
      {[{label:"Total Members",val:members.length,icon:"◉",color:"#6366f1"},{label:"Points Issued",val:totalPts,icon:"◆",color:"#f59e0b"},{label:"Referral Levels",val:ctx.refLevels.length,icon:"◈",color:"#10b981"},{label:"Active Tiers",val:tiers.length,icon:"◎",color:"#f97316"}].map(k=>(
        <div key={k.label} className="card card-h" style={{padding:"20px 22px"}}>
          <div style={{fontSize:20,marginBottom:10,color:k.color}}>{k.icon}</div>
          <div style={{fontSize:26,fontWeight:700,color:"#e8eaf0"}}><AnimNumber value={k.val}/></div>
          <div style={{fontSize:12,color:"#5566aa",marginTop:2}}>{k.label}</div>
        </div>
      ))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
      <div className="card" style={{padding:"22px 24px"}}>
        <div style={{fontWeight:700,color:"#ccd",marginBottom:18,fontSize:15}}>Tier Distribution</div>
        {tierCounts.map(t=>(
          <div key={t.id} style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:13,color:t.color,fontWeight:600}}>{t.icon} {t.name}</span>
              <span style={{fontSize:12,color:"#5566aa"}}>{t.count} · {t.minPoints.toLocaleString()}+ pts</span>
            </div>
            <PBar value={t.count} max={members.length||1} color={t.color}/>
          </div>
        ))}
      </div>
      <div className="card" style={{padding:"22px 24px"}}>
        <div style={{fontWeight:700,color:"#ccd",marginBottom:18,fontSize:15}}>Top Members</div>
        {[...members].sort((a,b)=>b.points-a.points).slice(0,5).map((m,i)=>{
          const tier=getTier(m.points,tiers);
          return <div key={m.id} onClick={()=>onSelect(m.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid #1a2030",cursor:"pointer"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:`${tier.color}22`,border:`1px solid ${tier.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:tier.color,fontWeight:700}}>{i+1}</div>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#ccd"}}>{m.name}</div><TierBadge tier={tier}/></div>
            <div style={{fontSize:14,fontWeight:700,color:tier.color}}>{m.points.toLocaleString()}</div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}

// ─── MEMBERS ─────────────────────────────────────────────────────────────────
function Members({ctx,onSelect}){
  const {members,tiers}=ctx;
  const [q,setQ]=useState("");
  const filtered=members.filter(m=>m.name.toLowerCase().includes(q.toLowerCase())||m.phone.includes(q));
  return <div className="fi">
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
      <div>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Members</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>{members.length} enrolled</p>
      </div>
      <input className="inp" placeholder="Search name or phone…" value={q} onChange={e=>setQ(e.target.value)} style={{width:240}}/>
    </div>
    <div className="card" style={{overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr style={{borderBottom:"1px solid #1a2030"}}>
          {["Member","Phone","Tier","Points","Referred By","Birthday","Joined"].map(h=><th key={h} style={{padding:"14px 20px",textAlign:"left",fontSize:11,fontWeight:600,color:"#445566",letterSpacing:.8,textTransform:"uppercase"}}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map(m=>{
            const tier=getTier(m.points,tiers);const ref=members.find(x=>x.id===m.referredBy);
            return <tr key={m.id} className="row" onClick={()=>onSelect(m.id)} style={{borderBottom:"1px solid #0e1825",cursor:"pointer"}}>
              <td style={{padding:"14px 20px",fontWeight:600,color:"#ccd",fontSize:14,transition:"background .15s"}}>{m.name}</td>
              <td style={{padding:"14px 20px",color:"#8899bb",fontSize:13}}>{m.phone}</td>
              <td style={{padding:"14px 20px"}}><TierBadge tier={tier}/></td>
              <td style={{padding:"14px 20px",fontWeight:700,color:tier.color,fontSize:14}}>{m.points.toLocaleString()}</td>
              <td style={{padding:"14px 20px",color:"#6677aa",fontSize:13}}>{ref?ref.name:<span style={{color:"#2a3a55"}}>—</span>}</td>
              <td style={{padding:"14px 20px",color:"#f59e0b",fontSize:12}}>{m.birthday?fmtBirthday(m.birthday,"short")||"—":<span style={{color:"#2a3a55"}}>—</span>}</td>
              <td style={{padding:"14px 20px",color:"#5566aa",fontSize:12}}>{m.joinedAt}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}

// ─── ENROLL ───────────────────────────────────────────────────────────────────
function Enroll({ctx,onDone}){
  const {members,enrollMember,showToast,appConfig,merchants}=ctx;
  const [form,setForm]=useState({name:"",phone:"",ref:"",pin:"",birthday:"",merchantCode:""});
  const [err,setErr]=useState({});
  const submit=()=>{
    const e={};
    if(!form.name.trim())e.name="Name required";
    if(form.phone.replace(/\D/g,"").length<10)e.phone="Valid phone required";
    if(form.pin&&!/^\d{4}$/.test(form.pin))e.pin="PIN must be exactly 4 digits";
    if(merchants.length>0&&!form.merchantCode)e.merchantCode="Merchant code is required.";
    if(form.merchantCode&&merchants.length>0&&!merchants.find(m=>m.code===form.merchantCode))e.merchantCode="Invalid merchant code.";
    if(Object.keys(e).length){setErr(e);return;}
    const pin=form.pin||"0000";
    const m=enrollMember(form.name.trim(),form.phone,form.ref||null,pin,form.birthday||"",form.merchantCode);
    const wMsg=ctx.appConfig?.welcomeEnabled!==false?` ${ctx.appConfig?.welcomePts||100} welcome pts awarded.`:" Enrolled with 0 pts.";
    showToast(`${m.name} enrolled! PIN: ${pin}.${wMsg}`);
    setForm({name:"",phone:"",ref:"",pin:"",birthday:"",merchantCode:""});setErr({});
  };
  return <div className="fi" style={{maxWidth:520}}>
    <div style={{marginBottom:28}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Enroll Member</h1>
      <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>New members receive 100 welcome points</p>
    </div>
    <div className="card" style={{padding:"28px 30px",display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <label className="lbl">Full Name *</label>
        <input className="inp" placeholder="e.g. Ahmad Razali" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
        {err.name&&<div style={{color:"#ff6b6b",fontSize:12,marginTop:5}}>{err.name}</div>}
      </div>
      <div>
        <label className="lbl">Mobile Number *</label>
        <input className="inp" placeholder="012-3456-789" value={form.phone} onChange={e=>setForm(f=>({...f,phone:fmtPhone(e.target.value)}))}/>
        {err.phone&&<div style={{color:"#ff6b6b",fontSize:12,marginTop:5}}>{err.phone}</div>}
      </div>

      {merchants.length>0&&<div>
        <label className="lbl">Merchant Code *</label>
        <select className="inp" value={form.merchantCode} onChange={e=>setForm(f=>({...f,merchantCode:e.target.value}))}>
          <option value="">— Select Merchant —</option>
          {merchants.filter(m=>m.active!==false).map(m=><option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}
        </select>
        {err.merchantCode&&<div style={{color:"#ff6b6b",fontSize:12,marginTop:5}}>{err.merchantCode}</div>}
      </div>}
      <div>
        <label className="lbl">Referred By</label>
        <select className="inp" value={form.ref} onChange={e=>setForm(f=>({...f,ref:e.target.value}))}>
          <option value="">— None —</option>
          {members.map(m=><option key={m.id} value={m.id}>{m.name} ({m.phone})</option>)}
        </select>
      </div>
      <div>
        <label className="lbl">Member PIN (4 digits)</label>
        <input className="inp" placeholder="e.g. 1234 — leave blank for 0000" maxLength={4} value={form.pin} onChange={e=>setForm(f=>({...f,pin:e.target.value.replace(/\D/g,"").slice(0,4)}))}/>
        {err.pin&&<div style={{color:"#ff6b6b",fontSize:12,marginTop:5}}>{err.pin}</div>}
        <div style={{fontSize:11,color:"#445566",marginTop:5}}>Member uses this PIN to log in on the Member Portal</div>
      </div>
      <div>
        <label className="lbl">Date of Birth <span style={{color:"#2a3a55",fontWeight:400,textTransform:"none",letterSpacing:0}}>(optional)</span></label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label className="lbl" style={{fontSize:10}}>Month</label>
            <select className="inp" value={form.birthday?form.birthday.split("-")[0]:""} onChange={e=>{const d=form.birthday?form.birthday.split("-")[1]||"01":"01";setForm(f=>({...f,birthday:e.target.value?`${e.target.value}-${d}`:""}));}}>
              <option value="">— Month —</option>
              {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i)=><option key={m} value={m}>{["January","February","March","April","May","June","July","August","September","October","November","December"][i]}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl" style={{fontSize:10}}>Day</label>
            <select className="inp" value={form.birthday?form.birthday.split("-")[1]||"":""} onChange={e=>{const mo=form.birthday?form.birthday.split("-")[0]||"01":"01";setForm(f=>({...f,birthday:mo&&e.target.value?`${mo}-${e.target.value}`:""}));}}>
              <option value="">— Day —</option>
              {Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0")).map(d=><option key={d} value={d}>{parseInt(d)}</option>)}
            </select>
          </div>
        </div>
        <div style={{fontSize:11,color:"#445566",marginTop:5}}>Used for birthday month WhatsApp campaigns</div>
      </div>
      <div style={{background:appConfig?.welcomeEnabled!==false?"#0a1a0d":"#1a0d0d",border:`1px solid ${appConfig?.welcomeEnabled!==false?"#1a3a1a":"#3a1a1a"}`,borderRadius:10,padding:"12px 16px",fontSize:13,color:appConfig?.welcomeEnabled!==false?"#4a8a5a":"#aa7777"}}>
        {appConfig?.welcomeEnabled!==false
          ?<>⭐ <strong style={{color:"#4ade80"}}>{appConfig?.welcomePts||100} welcome points</strong> will be awarded on enrollment.</>
          :<>⚠️ Welcome bonus is <strong style={{color:"#ff9999"}}>disabled</strong>. Member will start with 0 points.</>
        }
      </div>
      <div style={{display:"flex",gap:12}}>
        <button className="btn" onClick={submit}>⊕ Enroll Member</button>
        <button className="btn-g" onClick={onDone}>View Members</button>
      </div>
    </div>
  </div>;
}

// ─── AWARD POINTS ─────────────────────────────────────────────────────────────
function AwardPts({ctx}){
  const {members,tiers,refLevels,awardPoints,showToast,merchants}=ctx;
  const [tab,setTab]=useState("award"); // award | report
  const [sel,setSel]=useState("");
  const [selMerchant,setSelMerchant]=useState("");
  const [raw,setRaw]=useState("");
  const [note,setNote]=useState("");
  const member=members.find(m=>m.id===sel);
  const activeMerchants=(merchants||[]).filter(m=>m.active!==false);
  const selectedMerchant=activeMerchants.find(m=>m.code===selMerchant);

  const preview=()=>{
    if(!member||!raw||!selMerchant)return null;
    const tier=getTier(member.points,tiers);
    const base=parseInt(raw)||0;
    const eff=Math.round(base*tier.multiplier);
    const ancs=getAncestors(members,member.id,refLevels.length);
    const ov=ancs.map(a=>{
      const rl=refLevels.find(r=>r.level===a.level);
      const am=members.find(m=>m.id===a.id);
      return rl?{level:rl.level,pct:rl.overridePercent,pts:Math.round(eff*rl.overridePercent/100),name:am?.name,color:rl.color}:null;
    }).filter(Boolean);
    return{base,eff,tier,ov};
  };
  const pv=preview();

  const award=()=>{
    if(!member||!raw||!selMerchant)return;
    const label=(note?note+" — ":"")+`via ${selectedMerchant?.name||selMerchant}`;
    awardPoints(member.id,parseInt(raw)||0,label,selMerchant);
    showToast(`Points awarded to ${member.name} via ${selectedMerchant?.name}!`);
    setSel("");setRaw("");setNote("");setSelMerchant("");
  };

  // ── Report data ──
  const reportMerchants=activeMerchants.map(m=>{
    const txns=members.flatMap(mb=>(mb.transactions||[]).filter(t=>t.merchantCode===m.code&&t.pts>0));
    const uniqueMembers=new Set(members.filter(mb=>(mb.transactions||[]).some(t=>t.merchantCode===m.code&&t.pts>0)).map(mb=>mb.id)).size;
    const totalPts=txns.reduce((s,t)=>s+t.pts,0);
    const txnCount=txns.length;
    return{...m,txnCount,uniqueMembers,totalPts};
  }).sort((a,b)=>b.totalPts-a.totalPts);

  const grandTotal=reportMerchants.reduce((s,m)=>s+m.totalPts,0);
  const grandTxns=reportMerchants.reduce((s,m)=>s+m.txnCount,0);

  return(
    <div className="fi" style={{maxWidth:720}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Award Points</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Multiplied by tier · Referral overrides cascade upward · Synced live</p>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:8,marginBottom:22}}>
        {[{id:"award",label:"◆ Award Points"},{id:"report",label:"📊 Merchant Report"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,
              background:tab===t.id?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",
              color:tab===t.id?"#000":"#5566aa",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── AWARD TAB ── */}
      {tab==="award"&&<div className="card" style={{padding:"28px 30px",display:"flex",flexDirection:"column",gap:18}}>

        {/* Merchant selector — required */}
        <div>
          <label className="lbl">Merchant <span style={{color:"#f87171",fontWeight:700}}>*</span></label>
          {activeMerchants.length===0
            ?<div style={{background:"#1a0d0d",border:"1px solid #3a1a1a",borderRadius:10,padding:"12px 16px",fontSize:13,color:"#aa7777"}}>
                ⚠️ No active merchants configured. Go to <strong style={{color:"#f59e0b"}}>🏪 Merchants</strong> to add merchants before awarding points.
              </div>
            :<select className="inp" value={selMerchant} onChange={e=>setSelMerchant(e.target.value)}>
              <option value="">— Select Merchant —</option>
              {activeMerchants.map(m=><option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}
            </select>
          }
          {selMerchant&&selectedMerchant&&<div style={{marginTop:8,background:"#0a1020",borderRadius:8,padding:"10px 14px",border:"1px solid #1a2535",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:"#10b981",background:"#0d2a1a",padding:"3px 8px",borderRadius:6}}>{selectedMerchant.code}</span>
            <div>
              <div style={{fontSize:13,color:"#ccd",fontWeight:600}}>{selectedMerchant.name}</div>
              {selectedMerchant.contact&&<div style={{fontSize:11,color:"#445566"}}>{selectedMerchant.contact}</div>}
            </div>
          </div>}
        </div>

        {/* Member selector */}
        <div>
          <label className="lbl">Select Member <span style={{color:"#f87171",fontWeight:700}}>*</span></label>
          <select className="inp" value={sel} onChange={e=>setSel(e.target.value)} disabled={!selMerchant}>
            <option value="">{selMerchant?"— Choose member —":"— Select merchant first —"}</option>
            {members.map(m=>{const t=getTier(m.points,tiers);return <option key={m.id} value={m.id}>{m.name} · {t.name} · {m.points} pts</option>;})}
          </select>
        </div>

        {member&&<div style={{background:"#0a1020",borderRadius:10,padding:"12px 16px",border:"1px solid #1a2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontWeight:700,color:"#ccd",fontSize:15}}>{member.name}</div><div style={{color:"#6677aa",fontSize:12,marginTop:2}}>{member.phone}</div></div>
          <div style={{textAlign:"right"}}><TierBadge tier={getTier(member.points,tiers)}/><div style={{fontSize:12,color:"#6677aa",marginTop:4}}>×{getTier(member.points,tiers).multiplier}</div></div>
        </div>}

        <div><label className="lbl">Base Points <span style={{color:"#f87171",fontWeight:700}}>*</span></label><input className="inp" type="number" min="1" placeholder="200" value={raw} onChange={e=>setRaw(e.target.value)} disabled={!selMerchant}/></div>
        <div><label className="lbl">Note <span style={{color:"#2a3a55",fontWeight:400,textTransform:"none",letterSpacing:0}}>(optional)</span></label><input className="inp" placeholder="e.g. Dining purchase, Monthly spend" value={note} onChange={e=>setNote(e.target.value)}/></div>

        {pv&&<div style={{background:"#0d1a10",border:"1px solid #1a3a1a",borderRadius:12,padding:"16px 18px"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#4ade80",letterSpacing:.8,marginBottom:12,textTransform:"uppercase"}}>Preview</div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
            <span style={{color:"#6a9a6a",fontSize:13}}>Merchant</span>
            <span style={{color:"#10b981",fontWeight:600,fontFamily:"monospace"}}>{selectedMerchant?.name}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{color:"#6a9a6a",fontSize:13}}>Base</span><span style={{color:"#ccd",fontWeight:600}}>{pv.base.toLocaleString()}</span></div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{color:"#6a9a6a",fontSize:13}}>{pv.tier.name} ×{pv.tier.multiplier}</span><span style={{color:pv.tier.color,fontWeight:700}}>{pv.eff.toLocaleString()} pts</span></div>
          {pv.ov.length>0&&<>
            <div style={{borderTop:"1px solid #1a3a1a",margin:"8px 0",paddingTop:8,fontSize:11,color:"#4a7a4a",textTransform:"uppercase",letterSpacing:.8}}>Referral Overrides</div>
            {pv.ov.map((o,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{color:"#6a9a6a",fontSize:13}}>L{o.level}: {o.name} ({o.pct}%)</span><span style={{color:o.color,fontWeight:600}}>+{o.pts}</span></div>)}
          </>}
        </div>}

        <button className="btn" onClick={award} disabled={!sel||!raw||!selMerchant}
          style={{opacity:(!sel||!raw||!selMerchant)?0.4:1}}>
          ◆ Award Points{selectedMerchant?` via ${selectedMerchant.name}`:""}
        </button>
        {!selMerchant&&<div style={{fontSize:12,color:"#445566",textAlign:"center"}}>Select a merchant to enable point awarding</div>}
      </div>}

      {/* ── MERCHANT REPORT TAB ── */}
      {tab==="report"&&<div>
        {/* Summary */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
          {[
            {label:"Active Merchants", val:activeMerchants.length,       color:"#10b981",bg:"#0d2a1a",border:"#1a4a2a"},
            {label:"Total Pts Awarded",val:grandTotal.toLocaleString(),   color:"#f59e0b",bg:"#1a1208",border:"#3a2a12"},
            {label:"Total Transactions",val:grandTxns,                   color:"#60a5fa",bg:"#0d1a2a",border:"#1a3050"},
          ].map(s=>(
            <div key={s.label} className="card" style={{padding:"16px 18px",background:s.bg,border:`1px solid ${s.border}`}}>
              <div style={{fontSize:22,fontWeight:800,color:s.color,marginBottom:2}}>{s.val}</div>
              <div style={{fontSize:11,color:s.color,opacity:.6,textTransform:"uppercase",letterSpacing:.5}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Merchant table */}
        <div className="card" style={{overflow:"hidden",marginBottom:20}}>
          <div style={{display:"grid",gridTemplateColumns:"80px 1fr 90px 90px 110px",
            borderBottom:"1px solid #1a2030",padding:"12px 16px"}}>
            {["Code","Merchant","Members","Txns","Pts Awarded"].map(h=>(
              <div key={h} style={{fontSize:11,fontWeight:600,color:"#445566",letterSpacing:.8,textTransform:"uppercase"}}>{h}</div>
            ))}
          </div>
          {reportMerchants.length===0&&<div style={{textAlign:"center",padding:"32px",color:"#2a3a55",fontSize:13}}>No transactions yet.</div>}
          {reportMerchants.map((m,i)=>(
            <div key={m.id} style={{display:"grid",gridTemplateColumns:"80px 1fr 90px 90px 110px",
              padding:"12px 16px",borderBottom:"1px solid #0e1825",
              background:i%2===0?"#080c12":"#090d14"}}>
              <div><span style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:"#10b981",background:"#0d2a1a",padding:"3px 8px",borderRadius:6}}>{m.code}</span></div>
              <div>
                <div style={{fontSize:13,color:"#ccd",fontWeight:500}}>{m.name}</div>
                {m.contact&&<div style={{fontSize:11,color:"#445566"}}>{m.contact}</div>}
              </div>
              <div style={{display:"flex",alignItems:"center"}}><span style={{fontSize:14,fontWeight:700,color:"#8899bb"}}>{m.uniqueMembers}</span></div>
              <div style={{display:"flex",alignItems:"center"}}><span style={{fontSize:14,fontWeight:700,color:"#8899bb"}}>{m.txnCount}</span></div>
              <div style={{display:"flex",alignItems:"center"}}><span style={{fontSize:15,fontWeight:800,color:"#f59e0b"}}>{m.totalPts.toLocaleString()}</span></div>
            </div>
          ))}
        </div>

        {/* Per-merchant transaction breakdown */}
        {reportMerchants.filter(m=>m.txnCount>0).map(m=>{
          const txnsForMerchant=members.flatMap(mb=>
            (mb.transactions||[])
              .filter(t=>t.merchantCode===m.code&&t.pts>0)
              .map(t=>({...t,memberName:mb.name,memberPhone:mb.phone,tier:getTier(mb.points,tiers)}))
          ).sort((a,b)=>(b.date||"").localeCompare(a.date||""));

          return(
            <div key={m.id} className="card" style={{padding:"20px 22px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:"#10b981",background:"#0d2a1a",padding:"4px 10px",borderRadius:8}}>{m.code}</span>
                <div>
                  <div style={{fontWeight:700,color:"#ccd",fontSize:14}}>{m.name}</div>
                  <div style={{fontSize:12,color:"#445566"}}>{m.txnCount} transaction{m.txnCount!==1?"s":""} · {m.totalPts.toLocaleString()} pts awarded total</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:240,overflowY:"auto"}}>
                {txnsForMerchant.map((t,i)=>(
                  <div key={t.id||i} style={{display:"grid",gridTemplateColumns:"1fr 140px 80px 80px",gap:8,alignItems:"center",
                    padding:"9px 12px",background:"#0a0f1a",borderRadius:8,border:"1px solid #1e2535"}}>
                    <div>
                      <div style={{fontSize:13,color:"#ccd",fontWeight:500}}>{t.memberName}</div>
                      <div style={{fontSize:11,color:"#445566"}}>{t.memberPhone}</div>
                    </div>
                    <div style={{fontSize:11,color:"#445566"}}>{t.label}</div>
                    <div style={{fontSize:11,color:"#5566aa",textAlign:"center"}}>{t.date}</div>
                    <div style={{fontSize:14,fontWeight:800,color:"#4ade80",textAlign:"right"}}>+{t.pts.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}


// ─── TRANSACTION HISTORY ──────────────────────────────────────────────────────
function TransactionHistory({member,tier}){
  const [filter,setFilter]=useState("all");   // all | earn | redeem
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const PER_PAGE=15;

  const txns=member.transactions||[];

  // Summary stats
  const totalEarned =txns.filter(t=>t.pts>0).reduce((s,t)=>s+t.pts,0);
  const totalRedeemed=txns.filter(t=>t.pts<0).reduce((s,t)=>s+Math.abs(t.pts),0);
  const earnCount   =txns.filter(t=>t.pts>0).length;
  const redeemCount =txns.filter(t=>t.pts<0).length;

  // Filter + search
  const filtered=txns.filter(t=>{
    const matchType=filter==="all"||(filter==="earn"&&t.pts>0)||(filter==="redeem"&&t.pts<0);
    const matchSearch=!search||t.label?.toLowerCase().includes(search.toLowerCase())||t.date?.toLowerCase().includes(search.toLowerCase());
    return matchType&&matchSearch;
  });

  const totalPages=Math.max(1,Math.ceil(filtered.length/PER_PAGE));
  const paginated=filtered.slice((page-1)*PER_PAGE,page*PER_PAGE);

  // Reset page when filter/search changes
  const setFilterAndReset=(f)=>{setFilter(f);setPage(1);};
  const setSearchAndReset=(s)=>{setSearch(s);setPage(1);};

  return(
    <div className="card" style={{padding:"24px 26px",gridColumn:"1/-1"}}>

      {/* Header + summary */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontWeight:700,color:"#ccd",fontSize:15,marginBottom:2}}>Transaction History</div>
          <div style={{fontSize:12,color:"#445566"}}>{txns.length} total transactions</div>
        </div>
        <div style={{display:"flex",gap:10}}>
          {[
            {label:"Total Earned",  val:"+"+totalEarned.toLocaleString(),  sub:earnCount+" transactions",    color:"#4ade80",bg:"#0d2a1a",border:"#1a4a2a"},
            {label:"Total Redeemed",val:"−"+totalRedeemed.toLocaleString(),sub:redeemCount+" redemptions",   color:"#f87171",bg:"#2a0d0d",border:"#4a1a1a"},
            {label:"Net Balance",   val:member.points.toLocaleString(),     sub:"current pts",               color:tier.color,bg:"#0a0f1a",border:"#1e2535"},
          ].map(s=>(
            <div key={s.label} style={{background:s.bg,border:`1px solid ${s.border}`,borderRadius:12,padding:"10px 16px",textAlign:"right",minWidth:120}}>
              <div style={{fontSize:16,fontWeight:800,color:s.color}}>{s.val}</div>
              <div style={{fontSize:10,color:s.color,opacity:.7,letterSpacing:.5,textTransform:"uppercase",marginTop:2}}>{s.sub}</div>
              <div style={{fontSize:10,color:"#2a3a55",marginTop:1}}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter + search row */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:6}}>
          {[["all","All"],["earn","Earned"],["redeem","Redeemed"]].map(([v,l])=>(
            <button key={v} onClick={()=>setFilterAndReset(v)}
              style={{padding:"7px 16px",borderRadius:99,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",
                background:filter===v?tier.color:"#0e1420",
                color:filter===v?"#000":"#5566aa",transition:"all .15s"}}>
              {l}
            </button>
          ))}
        </div>
        <input className="inp" placeholder="Search transactions…" value={search}
          onChange={e=>setSearchAndReset(e.target.value)}
          style={{flex:1,maxWidth:260,padding:"7px 12px",fontSize:13}}/>
        {filtered.length>0&&<div style={{fontSize:12,color:"#445566",marginLeft:"auto"}}>
          {filtered.length} result{filtered.length!==1?"s":""}
        </div>}
      </div>

      {/* Transaction list */}
      {paginated.length===0
        ?<div style={{textAlign:"center",padding:"32px 0",color:"#2a3a55",fontSize:13}}>
            No transactions found
          </div>
        :<div style={{display:"flex",flexDirection:"column",gap:6}}>
          {paginated.map((t,i)=>{
            const isEarn=t.pts>0;
            return(
              <div key={t.id||i} style={{display:"flex",alignItems:"center",gap:12,
                padding:"11px 14px",borderRadius:10,
                background:isEarn?"#0a1a10":"#1a0a0a",
                border:`1px solid ${isEarn?"#1a3a1a":"#3a1a1a"}`}}>
                {/* Icon */}
                <div style={{width:38,height:38,borderRadius:10,flexShrink:0,
                  background:isEarn?"#0d2a1a":"#2a0d0d",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                  {t.icon||( isEarn?"◆":"◇")}
                </div>
                {/* Label + date */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:"#ccd",fontWeight:500,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {t.label||"Transaction"}
                  </div>
                  <div style={{fontSize:11,color:"#445566",marginTop:2,display:"flex",gap:8,alignItems:"center"}}>
                    <span>{t.date||"—"}</span>
                    <span style={{width:3,height:3,borderRadius:"50%",background:"#2a3a55",display:"inline-block"}}/>
                    <span style={{color:isEarn?"#2a6a3a":"#6a2a2a",fontWeight:600,letterSpacing:.3,textTransform:"uppercase",fontSize:10}}>
                      {isEarn?"Earn":"Redeem"}
                    </span>
                  </div>
                </div>
                {/* Points */}
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:15,fontWeight:800,color:isEarn?"#4ade80":"#f87171"}}>
                    {isEarn?"+":""}{t.pts.toLocaleString()}
                  </div>
                  <div style={{fontSize:10,color:"#2a3a55",letterSpacing:.5}}>PTS</div>
                </div>
              </div>
            );
          })}
        </div>
      }

      {/* Pagination */}
      {totalPages>1&&<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:8,marginTop:16}}>
        <button className="btn-g" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
          style={{padding:"6px 14px",fontSize:12,opacity:page===1?0.4:1}}>← Prev</button>
        <span style={{fontSize:12,color:"#5566aa"}}>{page} / {totalPages}</span>
        <button className="btn-g" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
          style={{padding:"6px 14px",fontSize:12,opacity:page===totalPages?0.4:1}}>Next →</button>
      </div>}
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function Profile({ctx,memberId,onBack}){
  const {members,tiers,refLevels,setMembers,showToast}=ctx;
  const [resetPin,setResetPin]=useState("");
  const [showReset,setShowReset]=useState(false);
  const [showBday,setShowBday]=useState(false);
  const [editBday,setEditBday]=useState("");
  // Sync editBday when member changes - must be before any conditional return
  const member=members.find(m=>m.id===memberId);
  useEffect(()=>{ if(member) setEditBday(member.birthday||""); },[memberId, member?.birthday]);
  if(!member)return null;
  const tier=getTier(member.points,tiers);
  const nextTier=tiers.find(t=>t.minPoints>member.points);
  const referrer=members.find(m=>m.id===member.referredBy);
  const downline=getDownline(members,member.id,refLevels.length);
  const doResetPin=()=>{
    if(!/^\d{4}$/.test(resetPin)){showToast("PIN must be 4 digits","error");return;}
    setMembers(prev=>prev.map(m=>m.id===memberId?{...m,pin:resetPin}:m));
    showToast(`PIN reset to ${resetPin} for ${member.name}`);
    setShowReset(false);setResetPin("");
  };
  return <div className="fi">
    <button className="btn-g" onClick={onBack} style={{marginBottom:22,fontSize:13}}>← Back</button>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
      <div className="card" style={{padding:"28px 30px"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:`${tier.color}22`,border:`2px solid ${tier.color}66`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>{tier.icon}</div>
          <div><div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:"#e8eaf0"}}>{member.name}</div><TierBadge tier={tier}/></div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {[{l:"Phone",v:member.phone},{l:"Member ID",v:member.id},{l:"Date of Birth",v:member.birthday?fmtBirthday(member.birthday,"long")||"Not set":"Not set"},{l:"Joined",v:member.joinedAt},{l:"Referral Code",v:member.referralCode||"—"},{l:"Merchant",v:member.merchantCode||(()=>{return"—";})()},{l:"Referred By",v:referrer?referrer.name:"—"},{l:"Member PIN",v:member.pin||"0000"}].map(r=>(
            <div key={r.l} style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{color:"#5566aa",fontSize:13}}>{r.l}</span>
              <span style={{color:"#ccd",fontSize:13,fontWeight:500}}>{r.v}</span>
            </div>
          ))}
          <div style={{borderTop:"1px solid #1a2030",paddingTop:12,marginTop:4}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{color:"#5566aa",fontSize:13}}>Total Points</span>
              <span style={{color:tier.color,fontSize:18,fontWeight:800}}>{member.points.toLocaleString()}</span>
            </div>
            {nextTier&&<><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:11,color:"#445566"}}>Next: {nextTier.name}</span>
              <span style={{fontSize:11,color:"#445566"}}>{(nextTier.minPoints-member.points).toLocaleString()} to go</span>
            </div><PBar value={member.points-tier.minPoints} max={nextTier.minPoints-tier.minPoints} color={tier.color}/></>}
          </div>
        </div>
      </div>
      <TransactionHistory member={member} tier={tier}/>
      <div className="card" style={{padding:"24px 26px",gridColumn:"1/-1",display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:showReset?16:0}}>
            <div>
              <div style={{fontWeight:700,color:"#ccd",fontSize:15}}>Member PIN</div>
              <div style={{fontSize:12,color:"#445566",marginTop:2}}>Current PIN: <span style={{color:"#f59e0b",fontWeight:600,letterSpacing:2}}>{member.pin||"0000"}</span></div>
            </div>
            <button className="btn-g" onClick={()=>setShowReset(s=>!s)} style={{fontSize:12}}>{showReset?"Cancel":"Reset PIN"}</button>
          </div>
          {showReset&&<div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
            <div style={{flex:1}}>
              <label className="lbl">New 4-digit PIN</label>
              <input className="inp" maxLength={4} placeholder="e.g. 5678" value={resetPin} onChange={e=>setResetPin(e.target.value.replace(/\D/g,"").slice(0,4))} onKeyDown={e=>e.key==="Enter"&&doResetPin()}/>
            </div>
            <button className="btn" onClick={doResetPin} style={{whiteSpace:"nowrap"}}>Save PIN</button>
          </div>}
        </div>
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:showBday?16:0}}>
            <div>
              <div style={{fontWeight:700,color:"#ccd",fontSize:15}}>Date of Birth</div>
              <div style={{fontSize:12,color:"#445566",marginTop:2}}>{member.birthday?fmtBirthday(member.birthday,"long")||"Not set":<span style={{color:"#2a3a55"}}>Not set</span>}</div>
            </div>
            <button className="btn-g" onClick={()=>setShowBday(s=>!s)} style={{fontSize:12}}>{showBday?"Cancel":"Edit"}</button>
          </div>
          {showBday&&<div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
            <div style={{flex:1}}>
              <label className="lbl">Date of Birth</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <select className="inp" value={editBday?editBday.split("-")[0]:""} onChange={e=>{const d=editBday?editBday.split("-")[1]||"01":"01";setEditBday(e.target.value?`${e.target.value}-${d}`:"");}}>
                  <option value="">— Month —</option>
                  {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i)=><option key={m} value={m}>{["January","February","March","April","May","June","July","August","September","October","November","December"][i]}</option>)}
                </select>
                <select className="inp" value={editBday?editBday.split("-")[1]||"":""} onChange={e=>{const mo=editBday?editBday.split("-")[0]||"01":"01";setEditBday(mo&&e.target.value?`${mo}-${e.target.value}`:"");}}>
                  <option value="">— Day —</option>
                  {Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0")).map(d=><option key={d} value={d}>{parseInt(d)}</option>)}
                </select>
              </div>
            </div>
            <button className="btn" onClick={()=>{setMembers(prev=>prev.map(m=>m.id===memberId?{...m,birthday:editBday}:m));showToast("Birthday updated!");setShowBday(false);}} style={{whiteSpace:"nowrap"}}>Save</button>
          </div>}
        </div>
      </div>
      {downline.length>0&&<div className="card" style={{padding:"24px 26px",gridColumn:"1/-1"}}>
        <div style={{fontWeight:700,color:"#ccd",marginBottom:16,fontSize:15}}>Referral Network ({downline.length})</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
          {downline.map(d=>{const dm=members.find(m=>m.id===d.id);const rl=refLevels.find(r=>r.level===d.level);if(!dm||!rl)return null;
            return <div key={d.id} style={{background:"#0a1020",border:`1px solid ${rl.color}33`,borderRadius:10,padding:"10px 14px",minWidth:160}}>
              <div style={{fontSize:10,color:rl.color,letterSpacing:.8,textTransform:"uppercase",marginBottom:4}}>L{d.level} · {rl.overridePercent}%</div>
              <div style={{fontWeight:600,color:"#ccd",fontSize:13}}>{dm.name}</div>
              <div style={{fontSize:11,color:"#5566aa"}}>{dm.points.toLocaleString()} pts</div>
            </div>;
          })}
        </div>
      </div>}
    </div>
  </div>;
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────


// ─── REWARD THUMBNAIL ─────────────────────────────────────────────────────────
function RewardThumb({reward,size=48,radius=10}){
  return(
    <div style={{width:size,height:size,borderRadius:radius,flexShrink:0,overflow:"hidden",
      background:"#0a0f1a",display:"flex",alignItems:"center",justifyContent:"center"}}>
      {reward.image
        ?<img src={reward.image} alt={reward.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        :<span style={{fontSize:size*0.5}}>{reward.icon||"🎁"}</span>}
    </div>
  );
}

// ─── REDEEM REWARDS ──────────────────────────────────────────────────────────
function RedeemRewards({ctx}){
  const {members,tiers,rewards=[],setRewards,setMembers,showToast}=ctx;
  const [tab,setTab]=useState("redeem");

  // ── Image upload helper ──
  const readImage=(file)=>new Promise((resolve,reject)=>{
    if(!file) return resolve(null);
    if(file.size>500000){reject(new Error("Image must be under 500KB"));return;}
    const r=new FileReader();
    r.onload=e=>resolve(e.target.result);
    r.onerror=()=>reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });

  // ── Manage rewards ──
  const [editing,setEditing]=useState(null);
  const [editErr,setEditErr]=useState("");
  const [saving,setSaving]=useState(false);
  const [imgLoading,setImgLoading]=useState(false);

  const saveRewards=async(next)=>{
    setSaving(true);
    try{
      await window.storage.set(KEYS.rewards,JSON.stringify(next),true);
      setRewards(next);
      showToast("Rewards saved!");
    }catch(e){showToast("Failed to save — image may be too large","error");}
    setSaving(false);
  };

  const startNew=()=>setEditing({id:genId(),name:"",pts:"",icon:"🎁",image:null,category:"",active:true,isNew:true});
  const startEdit=(r)=>setEditing({...r,pts:String(r.pts)});
  const toggleActive=(id)=>saveRewards(rewards.map(r=>r.id===id?{...r,active:!r.active}:r));
  const deleteReward=async(id)=>{
    if(rewards.length<=1){showToast("Must keep at least one reward","error");return;}
    saveRewards(rewards.filter(r=>r.id!==id));
  };

  const handleImageUpload=async(e)=>{
    const file=e.target.files?.[0];
    if(!file)return;
    setImgLoading(true);
    try{
      const b64=await readImage(file);
      setEditing(v=>({...v,image:b64}));
    }catch(err){showToast(err.message||"Upload failed","error");}
    setImgLoading(false);
  };

  const saveEdit=async()=>{
    if(!editing.name.trim()){setEditErr("Name is required.");return;}
    if(!parseInt(editing.pts)||parseInt(editing.pts)<=0){setEditErr("Points must be greater than 0.");return;}
    setEditErr("");
    const item={
      id:editing.id,
      name:editing.name.trim(),
      pts:parseInt(editing.pts),
      icon:editing.icon||"🎁",
      image:editing.image||null,
      category:editing.category.trim(),
      active:editing.active!==false,
    };
    const next=editing.isNew?[...rewards,item]:rewards.map(r=>r.id===editing.id?item:r);
    await saveRewards(next);
    setEditing(null);
  };

  // ── Redeem flow ──
  const [sel,setSel]=useState("");
  const [selReward,setSelReward]=useState(null);
  const [confirm,setConfirm]=useState(false);
  const [catFilter,setCatFilter]=useState("All");
  const member=members.find(m=>m.id===sel);
  const tier=member?getTier(member.points,tiers):null;

  const reset=()=>{setSel("");setSelReward(null);setConfirm(false);};
  const doRedeem=()=>{
    if(!member||!selReward)return;
    setMembers(prev=>prev.map(m=>m.id===member.id
      ?{...m,points:m.points-selReward.pts,
          transactions:[{id:genId(),pts:-selReward.pts,icon:selReward.icon||"🎁",label:`${selReward.name} Redeemed`,date:today(),type:"redeem"},...m.transactions]}
      :m
    ));
    showToast(`${selReward.name} redeemed for ${member.name}! −${selReward.pts.toLocaleString()} pts`);
    reset();
  };

  const activeRewards=rewards.filter(r=>r.active!==false);
  const cats=["All",...new Set(activeRewards.map(r=>r.category).filter(Boolean))];
  const filtered=catFilter==="All"?activeRewards:activeRewards.filter(r=>r.category===catFilter);

  return(
    <div className="fi" style={{maxWidth:720}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Redeem Rewards</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Process member reward redemptions or manage the rewards catalogue</p>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:22}}>
        {[{id:"redeem",label:"🎁 Redeem for Member"},{id:"manage",label:"⚙️ Manage Catalogue"}].map(t=>(
          <button key={t.id} onClick={()=>{setTab(t.id);setEditing(null);}}
            style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,
              background:tab===t.id?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",
              color:tab===t.id?"#000":"#5566aa",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── MANAGE CATALOGUE ── */}
      {tab==="manage"&&<div style={{display:"flex",flexDirection:"column",gap:14}}>
        {editing&&<div className="card si" style={{padding:"24px 26px",marginBottom:4}}>
          <div style={{fontWeight:700,color:"#e8eaf0",fontSize:15,marginBottom:18}}>{editing.isNew?"New Reward":"Edit Reward"}</div>

          {/* Image upload section */}
          <div style={{marginBottom:18}}>
            <label className="lbl">Reward Image</label>
            <div style={{display:"flex",alignItems:"flex-start",gap:16,marginTop:6}}>
              {/* Preview */}
              <div style={{width:100,height:100,borderRadius:14,overflow:"hidden",flexShrink:0,
                background:"#0a0f1a",border:"2px dashed #1e2535",
                display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                {editing.image
                  ?<img src={editing.image} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  :<span style={{fontSize:36}}>{editing.icon||"🎁"}</span>}
                {editing.image&&<button
                  onClick={()=>setEditing(v=>({...v,image:null}))}
                  style={{position:"absolute",top:4,right:4,width:20,height:20,borderRadius:"50%",
                    background:"#cc0000",border:"none",color:"#fff",fontSize:11,cursor:"pointer",
                    display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>✕</button>}
              </div>
              {/* Upload controls */}
              <div style={{flex:1}}>
                <label style={{display:"block",padding:"10px 16px",background:"#0e1420",
                  border:"1px solid #1e2535",borderRadius:10,cursor:"pointer",
                  fontSize:13,color:"#8899bb",textAlign:"center",transition:"all .15s"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="#f59e0b44"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="#1e2535"}>
                  {imgLoading?"Uploading…":"📷 Click to upload image"}
                  <input type="file" accept="image/*" onChange={handleImageUpload}
                    style={{display:"none"}} disabled={imgLoading}/>
                </label>
                <div style={{fontSize:11,color:"#2a3a55",marginTop:8,lineHeight:1.6}}>
                  Accepted: JPG, PNG, WebP · Max 500KB<br/>
                  Recommended: square image (1:1 ratio)
                </div>
                {editing.image&&<div style={{fontSize:11,color:"#4ade80",marginTop:6}}>✓ Image uploaded</div>}
              </div>
            </div>
          </div>

          {/* Name, Points, Fallback icon */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 130px 70px",gap:14,marginBottom:14}}>
            <div>
              <label className="lbl">Reward Name *</label>
              <input className="inp" placeholder="e.g. Free Dessert" value={editing.name}
                onChange={e=>setEditing(v=>({...v,name:e.target.value}))}/>
            </div>
            <div>
              <label className="lbl">Points Cost *</label>
              <input className="inp" type="number" min="1" placeholder="200" value={editing.pts}
                onChange={e=>setEditing(v=>({...v,pts:e.target.value}))}/>
            </div>
            <div>
              <label className="lbl">Fallback Icon</label>
              <input className="inp" value={editing.icon||"🎁"} maxLength={2}
                onChange={e=>setEditing(v=>({...v,icon:e.target.value}))}
                style={{textAlign:"center",fontSize:20,padding:"10px 4px"}}
                title="Shown if no image is uploaded"/>
            </div>
          </div>

          {/* Category + Status */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 120px",gap:14,marginBottom:14}}>
            <div>
              <label className="lbl">Category <span style={{color:"#2a3a55",fontWeight:400,textTransform:"none",letterSpacing:0}}>(optional)</span></label>
              <input className="inp" placeholder="e.g. Dining, Stay, Wellness" value={editing.category}
                onChange={e=>setEditing(v=>({...v,category:e.target.value}))}/>
            </div>
            <div>
              <label className="lbl">Status</label>
              <select className="inp" value={editing.active?"active":"inactive"}
                onChange={e=>setEditing(v=>({...v,active:e.target.value==="active"}))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {editErr&&<div style={{color:"#f87171",fontSize:13,marginBottom:12,background:"#2a0d0d",borderRadius:8,padding:"8px 12px"}}>{editErr}</div>}
          <div style={{display:"flex",gap:10}}>
            <button className="btn" onClick={saveEdit} disabled={saving||imgLoading}
              style={{opacity:saving||imgLoading?0.6:1}}>
              {saving?"Saving…":"💾 Save Reward"}
            </button>
            <button className="btn-g" onClick={()=>{setEditing(null);setEditErr("");}}>Cancel</button>
          </div>
        </div>}

        {/* Reward list */}
        {rewards.map(r=>(
          <div key={r.id} className="card" style={{padding:"14px 18px",display:"flex",alignItems:"center",gap:14,opacity:r.active===false?0.5:1}}>
            <RewardThumb reward={r} size={52} radius={10}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                <span style={{fontWeight:700,color:"#ccd",fontSize:14}}>{r.name}</span>
                {r.category&&<span style={{fontSize:10,color:"#5566aa",background:"#0e1420",padding:"2px 8px",borderRadius:99,border:"1px solid #1e2535"}}>{r.category}</span>}
                {r.active===false&&<span style={{fontSize:10,color:"#886644",background:"#1a1008",padding:"2px 8px",borderRadius:99,border:"1px solid #2a2010"}}>Inactive</span>}
                {r.image&&<span style={{fontSize:10,color:"#4ade80",background:"#0d2a1a",padding:"2px 8px",borderRadius:99,border:"1px solid #1a4a2a"}}>📷 Has image</span>}
              </div>
              <div style={{fontSize:13,color:"#f59e0b",fontWeight:700}}>{r.pts.toLocaleString()} pts</div>
            </div>
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <button className="btn-g" onClick={()=>toggleActive(r.id)} style={{fontSize:11,padding:"6px 12px"}}>
                {r.active===false?"Enable":"Disable"}
              </button>
              <button className="btn-g" onClick={()=>startEdit(r)} style={{fontSize:11,padding:"6px 12px"}}>✏️ Edit</button>
              {rewards.length>1&&<button className="btn-d" onClick={()=>deleteReward(r.id)} style={{fontSize:11,padding:"6px 12px"}}>✕</button>}
            </div>
          </div>
        ))}
        <button className="btn-g" onClick={startNew} style={{alignSelf:"flex-start",padding:"10px 20px"}}>⊕ Add New Reward</button>
      </div>}

      {/* ── REDEEM FOR MEMBER ── */}
      {tab==="redeem"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Select Member</label>
            <select className="inp" value={sel} onChange={e=>{setSel(e.target.value);setSelReward(null);setConfirm(false);}}>
              <option value="">— Choose member —</option>
              {members.map(m=>{const t=getTier(m.points,tiers);return<option key={m.id} value={m.id}>{m.name} · {t.name} · {m.points.toLocaleString()} pts</option>;})}
            </select>
            {member&&<div style={{marginTop:12,background:"#0a1020",borderRadius:10,padding:"12px 16px",border:"1px solid #1a2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,color:"#ccd",fontSize:14}}>{member.name}</div>
                <div style={{color:"#6677aa",fontSize:12,marginTop:2}}>{member.phone}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <TierBadge tier={tier}/>
                <div style={{fontSize:14,color:"#f59e0b",fontWeight:800,marginTop:4}}>{member.points.toLocaleString()} pts</div>
              </div>
            </div>}
          </div>

          {member&&<div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Select Reward</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"8px 0 14px"}}>
              {cats.map(c=><button key={c} onClick={()=>setCatFilter(c)}
                style={{padding:"5px 12px",borderRadius:99,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",
                  background:catFilter===c?"linear-gradient(135deg,#f59e0b,#f97316)":"#0a0f1a",
                  color:catFilter===c?"#000":"#6677aa",transition:"all .15s"}}>
                {c}
              </button>)}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
              {filtered.length===0&&<div style={{color:"#2a3a55",fontSize:13,textAlign:"center",padding:"20px 0"}}>No active rewards in this category.</div>}
              {filtered.map(r=>{
                const canAfford=member.points>=r.pts;
                const isSel=selReward?.id===r.id;
                return(
                  <button key={r.id} onClick={()=>{if(canAfford){setSelReward(isSel?null:r);setConfirm(false);}}}
                    style={{padding:"10px 12px",borderRadius:10,textAlign:"left",
                      border:`1px solid ${isSel?"#f59e0b44":canAfford?"#1e2535":"#1a1a1a"}`,
                      background:isSel?"#1a1800":canAfford?"#0a0f1a":"#08080a",
                      cursor:canAfford?"pointer":"not-allowed",opacity:canAfford?1:0.4,transition:"all .15s"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <RewardThumb reward={r} size={40} radius={8}/>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,color:isSel?"#f5c842":"#ccd",fontSize:13}}>{r.name}</div>
                        {r.category&&<div style={{fontSize:10,color:"#445566",marginTop:1}}>{r.category}</div>}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:800,color:canAfford?"#f59e0b":"#445566",fontSize:14}}>{r.pts.toLocaleString()}</div>
                        <div style={{fontSize:9,color:"#445566",letterSpacing:.5}}>PTS</div>
                      </div>
                    </div>
                    {!canAfford&&<div style={{fontSize:10,color:"#5a3a1a",marginTop:4}}>Insufficient balance ({(r.pts-member.points).toLocaleString()} pts short)</div>}
                  </button>
                );
              })}
            </div>
          </div>}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {member&&selReward&&<div className="card" style={{padding:"24px 26px"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#f59e0b",letterSpacing:.8,textTransform:"uppercase",marginBottom:16}}>Redemption Summary</div>
            <div style={{textAlign:"center",marginBottom:20,background:"#0a0f1a",borderRadius:12,border:"1px solid #1e2535",overflow:"hidden"}}>
              {selReward.image
                ?<img src={selReward.image} alt={selReward.name} style={{width:"100%",maxHeight:160,objectFit:"cover"}}/>
                :<div style={{padding:"28px 20px",fontSize:52}}>{selReward.icon||"🎁"}</div>}
              <div style={{padding:"14px 20px"}}>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:"#e8eaf0",fontWeight:700}}>{selReward.name}</div>
                {selReward.category&&<div style={{fontSize:11,color:"#5566aa",marginTop:4}}>{selReward.category}</div>}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
              {[
                {l:"Member",v:member.name,vc:"#ccd"},
                {l:"Current Balance",v:member.points.toLocaleString()+" pts",vc:"#f59e0b"},
                {l:"Redemption Cost",v:"−"+selReward.pts.toLocaleString()+" pts",vc:"#f87171"},
              ].map(row=>(
                <div key={row.l} style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{color:"#5566aa",fontSize:13}}>{row.l}</span>
                  <span style={{color:row.vc,fontWeight:600,fontSize:13}}>{row.v}</span>
                </div>
              ))}
              <div style={{borderTop:"1px solid #1e2535",paddingTop:10,display:"flex",justifyContent:"space-between"}}>
                <span style={{color:"#5566aa",fontSize:13}}>Remaining Balance</span>
                <span style={{color:"#4ade80",fontWeight:800,fontSize:16}}>{(member.points-selReward.pts).toLocaleString()} pts</span>
              </div>
            </div>
            {!confirm
              ?<button className="btn" onClick={()=>setConfirm(true)} style={{width:"100%",background:"linear-gradient(135deg,#f59e0b,#f97316)"}}>
                🎁 Confirm Redemption
              </button>
              :<div style={{background:"#0d1a0d",border:"1px solid #1a4a1a",borderRadius:12,padding:"16px 18px"}}>
                <div style={{color:"#4ade80",fontWeight:700,fontSize:14,marginBottom:8}}>✓ Confirm Redemption</div>
                <div style={{color:"#6a9a6a",fontSize:13,marginBottom:14,lineHeight:1.6}}>
                  Redeem <strong style={{color:"#86efac"}}>{selReward.name}</strong> for <strong style={{color:"#86efac"}}>{member.name}</strong>?<br/>
                  <strong style={{color:"#f87171"}}>{selReward.pts.toLocaleString()} pts</strong> will be deducted.
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button className="btn" onClick={doRedeem} style={{flex:1,background:"linear-gradient(135deg,#22c55e,#16a34a)"}}>✓ Yes, Redeem</button>
                  <button className="btn-g" onClick={()=>setConfirm(false)} style={{flex:1}}>Cancel</button>
                </div>
              </div>
            }
          </div>}
          {member&&!selReward&&<div className="card" style={{padding:"28px",textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12,opacity:.3}}>🎁</div>
            <div style={{color:"#2a3a55",fontSize:13}}>Select a reward from the left to proceed</div>
          </div>}
          {!member&&<div className="card" style={{padding:"28px",textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12,opacity:.3}}>👤</div>
            <div style={{color:"#2a3a55",fontSize:13}}>Select a member to see available rewards</div>
          </div>}
        </div>
      </div>}
    </div>
  );
}





// ─── WELCOME CONFIG ──────────────────────────────────────────────────────────
function WelcomeConfig({appConfig,setAppConfig,showToast}){
  const [enabled,setEnabled]=useState(appConfig.welcomeEnabled!==false);
  const [pts,setPts]=useState(String(appConfig.welcomePts||100));
  const [saving,setSaving]=useState(false);
  const [dirty,setDirty]=useState(false);

  const save=async()=>{
    const newPts=parseInt(pts)||0;
    if(newPts<0){showToast("Points cannot be negative","error");return;}
    setSaving(true);
    try{
      const next={welcomeEnabled:enabled,welcomePts:newPts};
      await window.storage.set(KEYS.config,JSON.stringify(next),true);
      setAppConfig(next);setDirty(false);
      showToast("Welcome points setting saved!");
    }catch(e){showToast("Failed to save","error");}
    setSaving(false);
  };

  return(
    <div className="si card" style={{padding:"28px 30px",maxWidth:480,display:"flex",flexDirection:"column",gap:24}}>
      <div>
        <div style={{fontWeight:700,color:"#e8eaf0",fontSize:16,marginBottom:4}}>Welcome Points</div>
        <div style={{fontSize:13,color:"#445566"}}>Configure points automatically awarded when a new member enrolls.</div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 20px",background:"#0a0f1a",borderRadius:14,border:`1px solid ${enabled?"#1a5a2a":"#1e2535"}`}}>
        <div>
          <div style={{fontWeight:600,color:"#ccd",fontSize:14}}>Enable Welcome Bonus</div>
          <div style={{fontSize:12,color:"#445566",marginTop:3}}>{enabled?"New members receive points on enrollment":"No points awarded on enrollment"}</div>
        </div>
        <button onClick={()=>{setEnabled(e=>!e);setDirty(true);}}
          style={{width:52,height:28,borderRadius:99,border:"none",cursor:"pointer",transition:"all .25s",
            background:enabled?"linear-gradient(135deg,#f59e0b,#f97316)":"#1e2535",position:"relative",flexShrink:0}}>
          <div style={{position:"absolute",top:3,left:enabled?26:3,width:22,height:22,borderRadius:"50%",
            background:"#fff",transition:"left .25s",boxShadow:"0 1px 4px #00000044"}}/>
        </button>
      </div>
      {enabled&&<div>
        <label className="lbl">Welcome Points Amount</label>
        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:4}}>
          <input className="inp" type="number" min="0" max="99999" value={pts}
            onChange={e=>{setPts(e.target.value);setDirty(true);}}
            style={{maxWidth:160,fontSize:22,fontWeight:700,textAlign:"center",padding:"12px"}}/>
          <div style={{fontSize:13,color:"#5566aa"}}>points awarded on enrollment</div>
        </div>
        <div style={{marginTop:10,background:"#0a1a0d",border:"1px solid #1a3a1a",borderRadius:10,padding:"12px 16px",fontSize:13,color:"#4a8a5a",lineHeight:1.6}}>
          New member gets <strong style={{color:"#4ade80"}}>{parseInt(pts)||0} pts</strong> balance on enrollment.
        </div>
      </div>}
      {!enabled&&<div style={{background:"#1a0d0d",border:"1px solid #3a1a1a",borderRadius:10,padding:"12px 16px",fontSize:13,color:"#aa7777",lineHeight:1.6}}>
        Members will enroll with <strong style={{color:"#ff9999"}}>0 points</strong> and no welcome transaction.
      </div>}
      <button className="btn" onClick={save} disabled={saving||!dirty}
        style={{alignSelf:"flex-start",padding:"11px 28px",opacity:saving||!dirty?0.5:1}}>
        {saving?"Saving…":"💾 Save Settings"}
      </button>
      <div style={{borderTop:"1px solid #1a2030",paddingTop:16,fontSize:12,color:"#2a3a55",lineHeight:1.8}}>
        <div style={{fontWeight:600,color:"#3a4a66",marginBottom:6}}>How it works:</div>
        <div>• When <strong style={{color:"#4466aa"}}>enabled</strong> — each new enrolled member automatically receives the configured points.</div>
        <div style={{marginTop:4}}>• When <strong style={{color:"#4466aa"}}>disabled</strong> — members enroll with 0 points.</div>
        <div style={{marginTop:4}}>• Changes apply to <strong style={{color:"#4466aa"}}>new enrollments only</strong>.</div>
      </div>
    </div>
  );
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
function Config({ctx}){
  const {tiers,setTiers,refLevels,setRefLevels,showToast,appConfig,setAppConfig, handleResetPoints, handleWipeAll}=ctx;
  const [tab,setTab]=useState("tiers");
  const [pwForm,setPwForm]=useState({current:"",next:"",confirm:""});
  const [pwErr,setPwErr]=useState("");
  const [pwShow,setPwShow]=useState({current:false,next:false,confirm:false});
  const [pwSaving,setPwSaving]=useState(false);
  const upT=(id,f,v)=>setTiers(p=>p.map(t=>t.id===id?{...t,[f]:f==="minPoints"||f==="multiplier"?Number(v):v}:t));
  const upR=(lv,f,v)=>setRefLevels(p=>p.map(r=>r.level===lv?{...r,[f]:f==="overridePercent"?Number(v):v}:r));

  const changePw=async()=>{
    const {adminPw:storedPw,setAdminPw}=ctx;
    const current=storedPw||import.meta.env.VITE_ADMIN_PASSWORD||"admin1234";
    if(pwForm.current!==current){setPwErr("Current password is incorrect.");return;}
    if(pwForm.next.length<4){setPwErr("New password must be at least 4 characters.");return;}
    if(pwForm.next!==pwForm.confirm){setPwErr("Passwords do not match.");return;}
    setPwSaving(true);
    try{
      await window.storage.set(KEYS.adminPw,pwForm.next,true);
      ctx.setAdminPw(pwForm.next);
      setPwForm({current:"",next:"",confirm:""});setPwErr("");
      showToast("Password changed successfully!");
    }catch(e){setPwErr("Failed to save — check Firebase connection.");}
    setPwSaving(false);
  };

  return <div className="fi">
    <div style={{marginBottom:24}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Configuration</h1>
      <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Changes sync live to the Member Portal</p>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:22,flexWrap:"wrap"}}>
      {["tiers","referral","welcome","password","danger"].map(t=>(
        <button key={t} onClick={()=>setTab(t)}
          style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,
            background:tab===t.id?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",
            color:tab===t.id?"#000":"#5566aa",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          {t==="tiers"?"🥇 Tiers":t==="referral"?"◈ Referral Overrides":t==="welcome"?"⭐ Welcome Points":t==="password"?"🔑 Admin Password":"⚠️ Danger Zone"}
        </button>
      ))}
    </div>
    {tab==="tiers"&&<div className="si" style={{display:"flex",flexDirection:"column",gap:14}}>
      {tiers.map(t=><div key={t.id} className="card" style={{padding:"20px 22px",display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr auto",gap:14,alignItems:"end"}}>
        <div><label className="lbl">Name</label><input className="inp" value={t.name} onChange={e=>upT(t.id,"name",e.target.value)}/></div>
        <div><label className="lbl">Min Pts</label><input className="inp" type="number" value={t.minPoints} onChange={e=>upT(t.id,"minPoints",e.target.value)}/></div>
        <div><label className="lbl">Multiplier</label><input className="inp" type="number" step=".05" value={t.multiplier} onChange={e=>upT(t.id,"multiplier",e.target.value)}/></div>
        <div><label className="lbl">Color</label><input className="inp" type="color" value={t.color} onChange={e=>upT(t.id,"color",e.target.value)} style={{height:44,padding:4}}/></div>
        <div><label className="lbl">Icon</label><input className="inp" value={t.icon} onChange={e=>upT(t.id,"icon",e.target.value)} maxLength={2}/></div>
        <button className="btn-d" onClick={()=>tiers.length>1&&setTiers(p=>p.filter(x=>x.id!==t.id))}>✕</button>
      </div>)}
      <div style={{display:"flex",gap:12}}>
        <button className="btn-g" onClick={()=>setTiers(p=>[...p,{id:genId(),name:"New Tier",minPoints:10000,color:"#888",bg:"#111",icon:"⭐",multiplier:2.5}])}>⊕ Add Tier</button>
        <button className="btn" onClick={()=>showToast("Tiers saved & synced!")}>Save Tiers</button>
      </div>
    </div>}
    {tab==="referral"&&<div className="si" style={{display:"flex",flexDirection:"column",gap:14}}>
      {refLevels.map(r=><div key={r.level} className="card" style={{padding:"20px 22px",display:"grid",gridTemplateColumns:"40px 2fr 1fr 1fr auto",gap:14,alignItems:"end"}}>
        <div style={{width:36,height:36,borderRadius:"50%",background:`${r.color}22`,border:`1px solid ${r.color}66`,display:"flex",alignItems:"center",justifyContent:"center",color:r.color,fontWeight:800,fontSize:14,marginBottom:4}}>L{r.level}</div>
        <div><label className="lbl">Label</label><input className="inp" value={r.label} onChange={e=>upR(r.level,"label",e.target.value)}/></div>
        <div><label className="lbl">Override %</label><input className="inp" type="number" min="0" max="100" value={r.overridePercent} onChange={e=>upR(r.level,"overridePercent",e.target.value)}/></div>
        <div><label className="lbl">Color</label><input className="inp" type="color" value={r.color} onChange={e=>upR(r.level,"color",e.target.value)} style={{height:44,padding:4}}/></div>
        <button className="btn-d" onClick={()=>refLevels.length>1&&setRefLevels(p=>p.filter(x=>x.level!==r.level).map((x,i)=>({...x,level:i+1})))}>✕</button>
      </div>)}
      <div style={{background:"#0d1a2a",border:"1px solid #1a3050",borderRadius:12,padding:"14px 18px",fontSize:13,color:"#5577aa"}}>
        <strong style={{color:"#7799cc"}}>Live:</strong> On 1,000 pts earned → L1 gets {Math.round(1000*(refLevels[0]?.overridePercent||0)/100)} pts, L2 gets {Math.round(1000*(refLevels[1]?.overridePercent||0)/100)} pts
      </div>
      <div style={{display:"flex",gap:12}}>
        <button className="btn-g" onClick={()=>setRefLevels(p=>[...p,{level:p.length+1,label:`Level ${p.length+1}`,overridePercent:1,color:"#888"}])}>⊕ Add Level</button>
        <button className="btn" onClick={()=>showToast("Referral config saved & synced!")}>Save Config</button>
      </div>
    </div>}
    {tab==="welcome"&&<WelcomeConfig appConfig={appConfig} setAppConfig={setAppConfig} showToast={showToast}/>}

    {tab==="password"&&<div className="si card" style={{padding:"28px 30px",maxWidth:460,display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <div style={{fontWeight:700,color:"#e8eaf0",fontSize:16,marginBottom:4}}>Change Admin Password</div>
        <div style={{fontSize:13,color:"#445566"}}>Default password: <span style={{color:"#f59e0b",fontWeight:600}}>admin1234</span></div>
      </div>
      {[{key:"current",label:"Current Password"},{key:"next",label:"New Password"},{key:"confirm",label:"Confirm New Password"}].map(({key,label})=>(
        <div key={key}>
          <label className="lbl">{label}</label>
          <div style={{position:"relative"}}>
            <input type={pwShow[key]?"text":"password"} className="inp" placeholder="••••••••" value={pwForm[key]}
              onChange={e=>{setPwForm(f=>({...f,[key]:e.target.value}));setPwErr("");}}
              onKeyDown={e=>e.key==="Enter"&&changePw()} style={{paddingRight:44}}/>
            <button onClick={()=>setPwShow(s=>({...s,[key]:!s[key]}))} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#445566",cursor:"pointer",fontSize:16,padding:2}}>{pwShow[key]?"🙈":"👁"}</button>
          </div>
        </div>
      ))}
      {pwErr&&<div style={{color:"#f87171",fontSize:13,background:"#2a0d0d",border:"1px solid #5a1a1a",borderRadius:8,padding:"10px 14px"}}>{pwErr}</div>}
      <button className="btn" onClick={changePw} style={{alignSelf:"flex-start",padding:"11px 28px",opacity:pwSaving?0.6:1}} disabled={pwSaving}>{pwSaving?"Saving…":"🔑 Change Password"}</button>
    </div>}

    {tab==="danger"&&<div className="si card" style={{padding:"28px 30px",maxWidth:480,display:"flex",flexDirection:"column",gap:24,border:"1px solid #4a1a1a",background:"#120a0a"}}>
      <div>
        <div style={{fontWeight:700,color:"#ff6b6b",fontSize:16,marginBottom:4}}>⚠️ Danger Zone</div>
        <div style={{fontSize:13,color:"#aa6666"}}>Destructive actions that cannot be undone.</div>
      </div>
      
      {/* Option 1: Reset Points */}
      <div style={{background:"#1a0a0a",border:"1px solid #3a1a1a",borderRadius:12,padding:"16px 18px", marginBottom: 12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:600,color:"#e8eaf0",fontSize:14}}>Reset Points & Transactions</div>
            <div style={{fontSize:12,color:"#aa6666",marginTop:4}}>Deletes all transactions and sets all member points to 0. <strong>Member profiles are kept.</strong></div>
          </div>
          <button 
            className="btn-danger" 
            onClick={handleResetPoints}
            style={{padding:"10px 24px",fontWeight:700,fontSize:13}}
          >
            ↻ Reset Points
          </button>
        </div>
      </div>

      {/* Option 2: Delete Everything */}
      <div style={{background:"#1a0a0a",border:"1px solid #3a1a1a",borderRadius:12,padding:"16px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:600,color:"#ff6b6b",fontSize:14}}>Delete All Data (Clean Slate)</div>
            <div style={{fontSize:12,color:"#aa6666",marginTop:4}}>Permanently deletes ALL members, merchants, points, transactions, and settings.</div>
          </div>
          <button 
            className="btn-danger" 
            onClick={handleWipeAll}
            style={{padding:"10px 24px",fontWeight:700,fontSize:13, background:"#3a0a0a"}}
          >
            ✕ Wipe All
          </button>
        </div>
      </div>

      <div style={{fontSize:12,color:"#6a3a3a",lineHeight:1.8,borderTop:"1px solid #2a0a0a",paddingTop:16}}>
        <strong style={{color:"#aa5555"}}>Warning:</strong> These actions are irreversible and will immediately wipe the live data visible to all merchants and members.
      </div>
    </div>}
  </div>;
}

// ─── WHATSAPP BLAST ───────────────────────────────────────────────────────────
const DEFAULT_WA_TEMPLATES = [
  { id:"promo",    label:"Promotion",       icon:"🎉", text:"Hi {name}! 🎉 We have an exclusive promotion just for you. Visit us today and enjoy special rewards on your next purchase. Your current balance is {points} pts ({tier} tier). Don't miss out!\n\n— B LOYALTY Team" },
  { id:"birthday", label:"Birthday Wish",   icon:"🎂", text:"Hi {name}! 🎂 Wishing you a wonderful birthday this {birthday}!\n\nAs a valued {tier} member, we have a special birthday treat waiting for you. Visit us this month to claim your birthday reward!\n\n🎁 Your current balance: {points} pts\n⭐ Tier: {tier} ({multiplier}x multiplier)\n\nHappy Birthday! 🥳\n\n— B LOYALTY Team" },
  { id:"points",   label:"Points Update",   icon:"✦",  text:"Hi {name}! Your B LOYALTY points balance has been updated.\n\n✦ Current Balance: {points} pts\n✦ Tier: {tier}\n✦ Multiplier: {multiplier}x\n\nKeep earning and unlock more rewards!\n\n— B LOYALTY Team" },
  { id:"redeem",   label:"Redeem Reminder", icon:"🎁", text:"Hi {name}! 🎁 Reminder: You have {points} pts ready to redeem on exciting rewards. Log in to your B LOYALTY portal to see what's available for you.\n\n— B LOYALTY Team" },
  { id:"tier",     label:"Tier Achievement", icon:"🏆", text:"Hi {name}! Congratulations! 🏆 You've reached {tier} tier status with {points} pts. Enjoy your {multiplier}x points multiplier on every purchase going forward!\n\n— B LOYALTY Team" },
];

function WhatsAppBlast({ctx}){
  const {members,tiers,waTemplates,setWaTemplates,showToast}=ctx;
  const templates=(waTemplates||DEFAULT_WA_TEMPLATES);
  const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const currentMonth=new Date().getMonth();

  const [tab,setTab]=useState("blast");
  const [step,setStep]=useState("compose");
  const [templateId,setTemplateId]=useState(templates[0]?.id||"");
  const [customText,setCustomText]=useState("");
  const [useCustom,setUseCustom]=useState(false);
  const [recipients,setRecipients]=useState("all");
  const [selTier,setSelTier]=useState("");
  const [selBdayMonth,setSelBdayMonth]=useState(String(currentMonth));
  const [selIds,setSelIds]=useState([]);
  const [sentIdx,setSentIdx]=useState(-1);
  const [sendLog,setSendLog]=useState([]);
  const [editing,setEditing]=useState(null);
  const [editErr,setEditErr]=useState("");
  const [saving,setSaving]=useState(false);

  const saveTemplates=async(next)=>{
    setSaving(true);
    try{
      await window.storage.set(KEYS.waTemplates,JSON.stringify(next),true);
      setWaTemplates(next);showToast("Templates saved!");
    }catch(e){showToast("Failed to save","error");}
    setSaving(false);
  };
  const startEdit=(t)=>setEditing({...t});
  const startNew=()=>setEditing({id:genId(),label:"",icon:"📢",text:"",isNew:true});
  const saveEdit=async()=>{
    if(!editing.label.trim()){setEditErr("Name is required.");return;}
    if(!editing.text.trim()){setEditErr("Message text is required.");return;}
    setEditErr("");
    const next=editing.isNew?[...templates,{id:editing.id,label:editing.label,icon:editing.icon,text:editing.text}]:templates.map(t=>t.id===editing.id?{id:t.id,label:editing.label,icon:editing.icon,text:editing.text}:t);
    await saveTemplates(next);setEditing(null);
  };
  const deleteTemplate=async(id)=>{
    if(templates.length<=1){showToast("Must keep at least one template","error");return;}
    const next=templates.filter(t=>t.id!==id);
    await saveTemplates(next);
    if(templateId===id)setTemplateId(next[0]?.id||"");
  };
  const template=templates.find(t=>t.id===templateId)||templates[0];
  const getBirthdayList=(monthIdx)=>members.filter(m=>{
    if(!m.birthday)return false;
    const p=parseBirthday(m.birthday);
    return p&&p.month===parseInt(monthIdx);
  });
  const getRecipients=()=>{
    if(recipients==="all")return members;
    if(recipients==="tier")return members.filter(m=>getTier(m.points,tiers).id===selTier);
    if(recipients==="birthday")return getBirthdayList(selBdayMonth);
    return members.filter(m=>selIds.includes(m.id));
  };
  const buildMsg=(member,rawText)=>{
    const tier=getTier(member.points,tiers);
    const bdayMonth=member.birthday?(()=>{const p=parseBirthday(member.birthday);return p?MONTHS[p.month]:"";})():"";
    return (rawText||"").replace(/{name}/g,member.name.split(" ")[0]).replace(/{fullname}/g,member.name).replace(/{points}/g,member.points.toLocaleString()).replace(/{tier}/g,tier.name).replace(/{multiplier}/g,tier.multiplier).replace(/{birthday}/g,bdayMonth);
  };
  const waLink=(phone,msg)=>{
    const num=phone.replace(/\D/g,"");
    const intl=num.startsWith("0")?"60"+num.slice(1):num;
    return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
  };
  const msgText=useCustom?customText:template?.text||"";
  const list=getRecipients();
  const bdayList=getBirthdayList(selBdayMonth);
  const sendAll=()=>{setSentIdx(0);setSendLog([]);setStep("sending");};
  const reset=()=>{setSentIdx(-1);setSendLog([]);setStep("compose");};
  const toggleId=(id)=>setSelIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  useEffect(()=>{
    if(step!=="sending"||sentIdx<0||sentIdx>=list.length)return;
    const member=list[sentIdx];
    const msg=buildMsg(member,msgText);
    window.open(waLink(member.phone,msg),"_blank");
    setSendLog(l=>[...l,{name:member.name,phone:member.phone}]);
    const timer=setTimeout(()=>{
      if(sentIdx+1<list.length)setSentIdx(i=>i+1);
      else setStep("done");
    },1500);
    return()=>clearTimeout(timer);
  },[sentIdx,step]);

  if(step==="done")return(
    <div className="fi" style={{maxWidth:560}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0",marginBottom:24}}>WhatsApp Blast</h1>
      <div className="card" style={{padding:"32px",textAlign:"center"}}>
        <div style={{fontSize:56,marginBottom:16}}>✅</div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#e8eaf0",marginBottom:8}}>Blast Complete</div>
        <div style={{color:"#5566aa",fontSize:14,marginBottom:24}}>{sendLog.length} messages opened via WhatsApp</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:260,overflowY:"auto",marginBottom:24,textAlign:"left"}}>
          {sendLog.map((l,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"9px 14px",background:"#0d2a1a",borderRadius:10,border:"1px solid #1a4a2a"}}>
              <span style={{color:"#ccd",fontSize:13,fontWeight:500}}>{l.name}</span>
              <span style={{color:"#4ade80",fontSize:12}}>✓ {l.phone}</span>
            </div>
          ))}
        </div>
        <button className="btn" onClick={reset}>Send Another Blast</button>
      </div>
    </div>
  );

  if(step==="sending")return(
    <div className="fi" style={{maxWidth:560}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0",marginBottom:24}}>WhatsApp Blast</h1>
      <div className="card" style={{padding:"32px",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16,animation:"spin 1.5s linear infinite",display:"inline-block"}}>💬</div>
        <div style={{color:"#e8eaf0",fontSize:16,fontWeight:600,marginBottom:4}}>Sending {sentIdx+1} of {list.length}</div>
        <div style={{color:"#5566aa",fontSize:13,marginBottom:20}}>{list[sentIdx]?.name} · {list[sentIdx]?.phone}</div>
        <div style={{background:"#0a0f1a",borderRadius:10,height:6,overflow:"hidden",marginBottom:20}}>
          <div style={{height:"100%",background:"linear-gradient(90deg,#25d366,#128c7e)",borderRadius:10,width:`${((sentIdx+1)/list.length)*100}%`,transition:"width .4s ease"}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:180,overflowY:"auto",textAlign:"left",marginBottom:14}}>
          {sendLog.map((l,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 12px",background:"#0d2a1a",borderRadius:8,border:"1px solid #1a4a2a"}}>
              <span style={{color:"#ccd",fontSize:12}}>{l.name}</span>
              <span style={{color:"#4ade80",fontSize:11}}>✓ Opened</span>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,color:"#2a3a4a"}}>Allow pop-ups if prompted by your browser.</div>
      </div>
    </div>
  );

  return(
    <div className="fi" style={{maxWidth:720}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>WhatsApp Blast</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Send personalised messages to members via WhatsApp</p>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:22}}>
        {[{id:"blast",label:"💬 Send Blast"},{id:"manage",label:"✏️ Manage Templates"}].map(t=>(
          <button key={t.id} onClick={()=>{setTab(t.id);setEditing(null);}}
            style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,
              background:tab===t.id?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",
              color:tab===t.id?"#000":"#5566aa",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==="manage"&&<div>
        {editing&&<div className="card si" style={{padding:"24px 26px",marginBottom:20}}>
          <div style={{fontWeight:700,color:"#e8eaf0",fontSize:15,marginBottom:18}}>{editing.isNew?"New Template":"Edit Template"}</div>
          <div style={{display:"grid",gridTemplateColumns:"60px 1fr",gap:14,marginBottom:14}}>
            <div><label className="lbl">Icon</label><input className="inp" value={editing.icon} maxLength={2} onChange={e=>setEditing(v=>({...v,icon:e.target.value}))} style={{textAlign:"center",fontSize:20,padding:"10px 4px"}}/></div>
            <div><label className="lbl">Template Name</label><input className="inp" placeholder="e.g. Birthday Greeting" value={editing.label} onChange={e=>setEditing(v=>({...v,label:e.target.value}))}/></div>
          </div>
          <div style={{marginBottom:14}}>
            <label className="lbl">Message Text</label>
            <textarea value={editing.text} onChange={e=>setEditing(v=>({...v,text:e.target.value}))}
              placeholder={"Hi {name}! Use {points}, {tier}, {birthday} as placeholders."}
              style={{width:"100%",minHeight:140,background:"#0a0f1a",border:"1px solid #1e2535",borderRadius:10,color:"#e8eaf0",padding:"12px 14px",fontSize:13,fontFamily:"'DM Sans',sans-serif",resize:"vertical",outline:"none",lineHeight:1.7,marginTop:4}}></textarea>
            <div style={{marginTop:6,fontSize:11,color:"#2a3a55"}}>
              Placeholders: <span style={{color:"#445577"}}>&#123;name&#125;</span> · <span style={{color:"#445577"}}>&#123;points&#125;</span> · <span style={{color:"#445577"}}>&#123;tier&#125;</span> · <span style={{color:"#445577"}}>&#123;multiplier&#125;</span> · <span style={{color:"#f59e0b"}}>&#123;birthday&#125;</span>
            </div>
          </div>
          {editing.text&&<div style={{background:"#0a1a10",border:"1px solid #1a3a1a",borderRadius:10,padding:"14px",marginBottom:14}}>
            <div style={{fontSize:11,color:"#4a7a4a",fontWeight:700,letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>Preview</div>
            <div style={{fontSize:13,color:"#8899bb",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{buildMsg(members[0]||{name:"Ahmad",points:1200,phone:"",birthday:"03-15"},editing.text)}</div>
          </div>}
          {editErr&&<div style={{color:"#f87171",fontSize:13,marginBottom:12,background:"#2a0d0d",borderRadius:8,padding:"8px 12px"}}>{editErr}</div>}
          <div style={{display:"flex",gap:10}}>
            <button className="btn" onClick={saveEdit} style={{opacity:saving?0.6:1}} disabled={saving}>{saving?"Saving…":"💾 Save Template"}</button>
            <button className="btn-g" onClick={()=>{setEditing(null);setEditErr("");}}>Cancel</button>
          </div>
        </div>}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {templates.map(t=>(
            <div key={t.id} className="card" style={{padding:"18px 20px",display:"flex",gap:14,alignItems:"flex-start"}}>
              <div style={{fontSize:28,flexShrink:0,marginTop:2}}>{t.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,color:"#e8eaf0",fontSize:14,marginBottom:4}}>{t.label}</div>
                <div style={{fontSize:12,color:"#445566",lineHeight:1.6,whiteSpace:"pre-wrap",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical"}}>{t.text}</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8,flexShrink:0}}>
                <button className="btn-g" onClick={()=>startEdit(t)} style={{fontSize:12,padding:"7px 14px"}}>✏️ Edit</button>
                {templates.length>1&&<button className="btn-d" onClick={()=>deleteTemplate(t.id)} style={{fontSize:12,padding:"7px 14px"}}>✕</button>}
              </div>
            </div>
          ))}
          <button className="btn-g" onClick={startNew} style={{alignSelf:"flex-start",padding:"10px 20px"}}>⊕ Add New Template</button>
        </div>
      </div>}

      {tab==="blast"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Message Template</label>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
              {templates.map(t=>(
                <button key={t.id} onClick={()=>{setTemplateId(t.id);setUseCustom(false);}}
                  style={{padding:"11px 14px",borderRadius:10,fontSize:13,fontWeight:600,textAlign:"left",
                    background:templateId===t.id&&!useCustom?"#0d2a1a":"#0a0f1a",
                    border:`1px solid ${templateId===t.id&&!useCustom?"#1a5a2a":"#1e2535"}`,
                    color:templateId===t.id&&!useCustom?"#4ade80":"#6677aa",
                    fontFamily:"'DM Sans',sans-serif",transition:"all .15s"}}>
                  {t.icon} {t.label}
                </button>
              ))}
              <button onClick={()=>setUseCustom(true)}
                style={{padding:"11px 14px",borderRadius:10,fontSize:13,fontWeight:600,textAlign:"left",
                  background:useCustom?"#1a1a0d":"#0a0f1a",border:`1px solid ${useCustom?"#4a4a1a":"#1e2535"}`,
                  color:useCustom?"#f5c842":"#6677aa",fontFamily:"'DM Sans',sans-serif",transition:"all .15s"}}>
                ✏️ One-time Custom Message
              </button>
            </div>
          </div>
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">{useCustom?"Your Message":"Message Preview"}</label>
            {useCustom
              ?<textarea value={customText} onChange={e=>setCustomText(e.target.value)}
                  placeholder={"Hi {name}! Use {points}, {tier}, {birthday} as placeholders."}
                  style={{width:"100%",minHeight:140,background:"#0a0f1a",border:"1px solid #1e2535",borderRadius:10,color:"#e8eaf0",padding:"12px 14px",fontSize:13,fontFamily:"'DM Sans',sans-serif",resize:"vertical",outline:"none",lineHeight:1.6,marginTop:4}}></textarea>
              :<div style={{background:"#0a0f1a",borderRadius:10,padding:"14px",border:"1px solid #1e2535",fontSize:13,color:"#8899bb",lineHeight:1.7,whiteSpace:"pre-wrap",marginTop:4,minHeight:100}}>
                {buildMsg(members[0]||{name:"Ahmad",points:1200,phone:"",birthday:"03-15"},msgText)}
              </div>
            }
            <div style={{marginTop:8,fontSize:11,color:"#2a3a55"}}>
              Placeholders: &#123;name&#125; · &#123;points&#125; · &#123;tier&#125; · <span style={{color:"#f59e0b"}}>&#123;birthday&#125;</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Recipients</label>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
              {[{v:"all",l:`🌐 All Members (${members.length})`},{v:"birthday",l:"🎂 By Birthday Month"},{v:"tier",l:"🏅 By Tier"},{v:"select",l:"☑️ Select Individually"}].map(o=>(
                <button key={o.v} onClick={()=>setRecipients(o.v)}
                  style={{padding:"11px 14px",borderRadius:10,fontSize:13,fontWeight:600,textAlign:"left",
                    background:recipients===o.v?"#0d1a2a":"#0a0f1a",
                    border:`1px solid ${recipients===o.v?"#1a3050":"#1e2535"}`,
                    color:recipients===o.v?"#60a5fa":"#6677aa",
                    fontFamily:"'DM Sans',sans-serif",transition:"all .15s"}}>
                  {o.l}
                </button>
              ))}
            </div>
            {recipients==="birthday"&&<div style={{marginTop:14}}>
              <label className="lbl">Select Month</label>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:6}}>
                {MONTHS.map((m,i)=>{
                  const cnt=getBirthdayList(i).length;
                  const isThis=i===currentMonth;
                  const isSel=selBdayMonth===String(i);
                  return(
                    <button key={i} onClick={()=>setSelBdayMonth(String(i))}
                      style={{padding:"8px 4px",borderRadius:8,fontSize:11,fontWeight:600,textAlign:"center",
                        background:isSel?"#0d1a2a":isThis?"#0a1a10":"#0a0f1a",
                        border:`1px solid ${isSel?"#1a3050":isThis?"#1a4a2a":"#1e2535"}`,
                        color:isSel?"#60a5fa":isThis?"#4ade80":cnt>0?"#8899bb":"#2a3a4a",
                        cursor:"pointer",transition:"all .15s"}}>
                      {m.slice(0,3)}<br/>
                      <span style={{fontSize:10,opacity:.7}}>{cnt}m</span>
                      {isThis&&<div style={{fontSize:9,color:"#4ade80",marginTop:1}}>●now</div>}
                    </button>
                  );
                })}
              </div>
              {bdayList.length===0&&<div style={{marginTop:10,fontSize:12,color:"#445566",background:"#0a0f1a",borderRadius:8,padding:"10px 14px"}}>
                No members with birthdays in {MONTHS[parseInt(selBdayMonth)]}.
              </div>}
              {bdayList.length>0&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6,maxHeight:160,overflowY:"auto"}}>
                {bdayList.map(m=>{const t=getTier(m.points,tiers);return(
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#0d1a2a",borderRadius:8,border:"1px solid #1a3050"}}>
                    <span style={{fontSize:16}}>🎂</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#ccd"}}>{m.name}</div>
                      <div style={{fontSize:11,color:"#445566"}}>{m.birthday?fmtBirthday(m.birthday,"short")||"":""}</div>
                    </div>
                    <span style={{fontSize:10,color:t.color,fontWeight:700,background:`${t.color}18`,padding:"2px 8px",borderRadius:99}}>{t.name}</span>
                  </div>
                );})}
              </div>}
            </div>}
            {recipients==="tier"&&<div style={{marginTop:12}}>
              <label className="lbl">Select Tier</label>
              <select className="inp" value={selTier} onChange={e=>setSelTier(e.target.value)}>
                <option value="">— Choose tier —</option>
                {tiers.map(t=>{const cnt=members.filter(m=>getTier(m.points,tiers).id===t.id).length;return<option key={t.id} value={t.id}>{t.icon} {t.name} ({cnt})</option>;})}
              </select>
            </div>}
            {recipients==="select"&&<div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
              {members.map(m=>{const t=getTier(m.points,tiers);return(
                <label key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:selIds.includes(m.id)?"#0d1a2a":"#0a0f1a",borderRadius:10,border:`1px solid ${selIds.includes(m.id)?"#1a3050":"#1e2535"}`,cursor:"pointer"}}>
                  <input type="checkbox" checked={selIds.includes(m.id)} onChange={()=>toggleId(m.id)} style={{accentColor:"#f59e0b",width:16,height:16}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#ccd"}}>{m.name}</div>
                    <div style={{fontSize:11,color:"#445566"}}>{m.phone}{m.birthday?" · 🎂 "+(fmtBirthday(m.birthday,"short")||""):""}</div>
                  </div>
                  <span style={{fontSize:10,color:t.color,fontWeight:700,background:`${t.color}18`,padding:"2px 8px",borderRadius:99}}>{t.name}</span>
                </label>
              );})}
            </div>}
          </div>
          <div className="card" style={{padding:"22px 24px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <span style={{color:"#5566aa",fontSize:13}}>Recipients</span>
              <span style={{color:"#f59e0b",fontWeight:700,fontSize:15}}>{list.length} member{list.length!==1?"s":""}</span>
            </div>
            {recipients==="birthday"&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <span style={{color:"#5566aa",fontSize:13}}>Birth Month</span>
              <span style={{color:"#f59e0b",fontSize:13,fontWeight:600}}>🎂 {MONTHS[parseInt(selBdayMonth)]}</span>
            </div>}
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:18}}>
              <span style={{color:"#5566aa",fontSize:13}}>Template</span>
              <span style={{color:"#ccd",fontSize:13,fontWeight:500}}>{useCustom?"✏️ Custom":template?.icon+" "+template?.label}</span>
            </div>
            <div style={{background:"#0a1a0d",border:"1px solid #1a3a1a",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#4a7a4a",lineHeight:1.6}}>
              📱 WhatsApp opens for each recipient with message pre-filled.
            </div>
            <button className="btn" onClick={sendAll} disabled={list.length===0||!msgText.trim()}
              style={{width:"100%",background:"linear-gradient(135deg,#25d366,#128c7e)",opacity:list.length===0||!msgText.trim()?0.4:1}}>
              💬 Send to {list.length} Member{list.length!==1?"s":""}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}

// ─── ALL TRANSACTIONS ─────────────────────────────────────────────────────────
function AllTransactions({ctx,onSelect}){
  const {members,tiers}=ctx;
  const [filter,setFilter]=useState("all");      // all | earn | redeem
  const [memberFilter,setMemberFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [page,setPage]=useState(1);
  const PER_PAGE=20;

  // Flatten all transactions with member info
  const allTxns=members.flatMap(m=>
    (m.transactions||[]).map(t=>({...t,memberId:m.id,memberName:m.name,memberPhone:m.phone,tier:getTier(m.points,tiers)}))
  ).sort((a,b)=>{
    // Sort by date descending - try to parse date strings
    const da=new Date(a.date); const db=new Date(b.date);
    if(!isNaN(da)&&!isNaN(db)) return db-da;
    return 0; // keep original order if unparseable
  });

  // Stats
  const totalEarned =allTxns.filter(t=>t.pts>0).reduce((s,t)=>s+t.pts,0);
  const totalRedeemed=allTxns.filter(t=>t.pts<0).reduce((s,t)=>s+Math.abs(t.pts),0);
  const earnCount   =allTxns.filter(t=>t.pts>0).length;
  const redeemCount =allTxns.filter(t=>t.pts<0).length;

  // Filter
  const filtered=allTxns.filter(t=>{
    if(filter==="earn"&&t.pts<=0) return false;
    if(filter==="redeem"&&t.pts>=0) return false;
    if(memberFilter!=="all"&&t.memberId!==memberFilter) return false;
    if(search){
      const q=search.toLowerCase();
      if(!t.label?.toLowerCase().includes(q)&&!t.memberName?.toLowerCase().includes(q)&&!t.date?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalPages=Math.max(1,Math.ceil(filtered.length/PER_PAGE));
  const safePage=Math.min(page,totalPages);
  const paginated=filtered.slice((safePage-1)*PER_PAGE,safePage*PER_PAGE);

  const reset=(fn)=>{ fn(); setPage(1); };

  return(
    <div className="fi">
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>All Transactions</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>{allTxns.length} total transactions across {members.length} members</p>
      </div>

      {/* Summary stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Total Transactions",val:allTxns.length,       sub:"all time",         color:"#60a5fa",bg:"#0d1a2a",border:"#1a3050"},
          {label:"Total Earned",      val:"+"+totalEarned.toLocaleString()+" pts", sub:earnCount+" transactions",    color:"#4ade80",bg:"#0d2a1a",border:"#1a4a2a"},
          {label:"Total Redeemed",    val:"−"+totalRedeemed.toLocaleString()+" pts",sub:redeemCount+" redemptions",  color:"#f87171",bg:"#2a0d0d",border:"#4a1a1a"},
          {label:"Active Members",    val:new Set(allTxns.map(t=>t.memberId)).size, sub:"with transactions",         color:"#f59e0b",bg:"#1a1208",border:"#3a2a12"},
        ].map(s=>(
          <div key={s.label} className="card" style={{padding:"16px 18px",background:s.bg,border:`1px solid ${s.border}`}}>
            <div style={{fontSize:18,fontWeight:800,color:s.color,marginBottom:2}}>{s.val}</div>
            <div style={{fontSize:10,color:s.color,opacity:.7,letterSpacing:.5,textTransform:"uppercase"}}>{s.sub}</div>
            <div style={{fontSize:11,color:"#2a3a55",marginTop:4}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div className="card" style={{padding:"16px 20px",marginBottom:16,display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
        {/* Type filter */}
        <div style={{display:"flex",gap:6}}>
          {[["all","All"],["earn","Earned"],["redeem","Redeemed"]].map(([v,l])=>(
            <button key={v} onClick={()=>reset(()=>setFilter(v))}
              style={{padding:"7px 14px",borderRadius:99,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",
                background:filter===v?"linear-gradient(135deg,#f59e0b,#f97316)":"#0a0f1a",
                color:filter===v?"#000":"#5566aa",transition:"all .15s"}}>
              {l}
            </button>
          ))}
        </div>

        {/* Member filter */}
        <select className="inp" value={memberFilter} onChange={e=>reset(()=>setMemberFilter(e.target.value))}
          style={{width:200,padding:"7px 12px",fontSize:13}}>
          <option value="all">All Members</option>
          {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        {/* Search */}
        <input className="inp" placeholder="Search label, member…" value={search}
          onChange={e=>reset(()=>setSearch(e.target.value))}
          style={{flex:1,minWidth:160,padding:"7px 12px",fontSize:13}}/>

        {/* Result count */}
        <div style={{fontSize:12,color:"#445566",whiteSpace:"nowrap"}}>
          {filtered.length} result{filtered.length!==1?"s":""}
        </div>

        {/* Clear filters */}
        {(filter!=="all"||memberFilter!=="all"||search)&&
          <button className="btn-g" onClick={()=>{setFilter("all");setMemberFilter("all");setSearch("");setPage(1);}}
            style={{fontSize:12,padding:"6px 14px",whiteSpace:"nowrap"}}>
            ✕ Clear
          </button>
        }
      </div>

      {/* Transactions table */}
      <div className="card" style={{overflow:"hidden"}}>
        {/* Table header */}
        <div style={{display:"grid",gridTemplateColumns:"44px 1fr 160px 100px 80px 80px",gap:0,
          borderBottom:"1px solid #1a2030",padding:"12px 16px"}}>
          {["","Transaction","Member","Date","Type","Points"].map((h,i)=>(
            <div key={i} style={{fontSize:11,fontWeight:600,color:"#445566",letterSpacing:.8,textTransform:"uppercase"}}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {paginated.length===0
          ?<div style={{textAlign:"center",padding:"40px 0",color:"#2a3a55",fontSize:13}}>No transactions found</div>
          :paginated.map((t,i)=>{
            const isEarn=t.pts>0;
            return(
              <div key={t.id||i}
                style={{display:"grid",gridTemplateColumns:"44px 1fr 160px 100px 80px 80px",gap:0,
                  padding:"12px 16px",borderBottom:"1px solid #0e1825",
                  background:i%2===0?"#080c12":"#090d14",
                  transition:"background .15s",cursor:"pointer"}}
                onClick={()=>onSelect(t.memberId)}
                onMouseEnter={e=>e.currentTarget.style.background="#0e1420"}
                onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"#080c12":"#090d14"}>

                {/* Icon */}
                <div style={{display:"flex",alignItems:"center"}}>
                  <div style={{width:32,height:32,borderRadius:8,
                    background:isEarn?"#0d2a1a":"#2a0d0d",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>
                    {t.icon||(isEarn?"◆":"◇")}
                  </div>
                </div>

                {/* Label */}
                <div style={{display:"flex",alignItems:"center"}}>
                  <div style={{fontSize:13,color:"#ccd",fontWeight:500,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}>
                    {t.label||"Transaction"}
                  </div>
                </div>

                {/* Member */}
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div>
                    <div style={{fontSize:12,color:"#8899bb",fontWeight:500}}>{t.memberName}</div>
                    <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                      <span style={{fontSize:9,color:t.tier.color,fontWeight:700,background:`${t.tier.color}18`,
                        padding:"1px 6px",borderRadius:99,letterSpacing:.5,textTransform:"uppercase"}}>
                        {t.tier.name}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Date */}
                <div style={{display:"flex",alignItems:"center"}}>
                  <span style={{fontSize:12,color:"#445566"}}>{t.date||"—"}</span>
                </div>

                {/* Type badge */}
                <div style={{display:"flex",alignItems:"center"}}>
                  <span style={{fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:"uppercase",
                    color:isEarn?"#4ade80":"#f87171",
                    background:isEarn?"#0d2a1a":"#2a0d0d",
                    padding:"3px 8px",borderRadius:99,border:`1px solid ${isEarn?"#1a4a2a":"#4a1a1a"}`}}>
                    {isEarn?"Earn":"Redeem"}
                  </span>
                </div>

                {/* Points */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end"}}>
                  <span style={{fontSize:14,fontWeight:800,color:isEarn?"#4ade80":"#f87171"}}>
                    {isEarn?"+":""}{t.pts.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })
        }
      </div>

      {/* Pagination */}
      {totalPages>1&&<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginTop:16}}>
        <button className="btn-g" onClick={()=>setPage(1)} disabled={safePage===1}
          style={{padding:"6px 12px",fontSize:12,opacity:safePage===1?0.4:1}}>«</button>
        <button className="btn-g" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={safePage===1}
          style={{padding:"6px 14px",fontSize:12,opacity:safePage===1?0.4:1}}>← Prev</button>
        <span style={{fontSize:13,color:"#5566aa",minWidth:80,textAlign:"center"}}>
          {safePage} / {totalPages}
        </span>
        <button className="btn-g" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={safePage===totalPages}
          style={{padding:"6px 14px",fontSize:12,opacity:safePage===totalPages?0.4:1}}>Next →</button>
        <button className="btn-g" onClick={()=>setPage(totalPages)} disabled={safePage===totalPages}
          style={{padding:"6px 12px",fontSize:12,opacity:safePage===totalPages?0.4:1}}>»</button>
      </div>}
    </div>
  );
}

// ─── MERCHANTS PAGE ───────────────────────────────────────────────────────────
function MerchantsPage({ctx}){
  const {members, merchants, showToast} = ctx;
  const [tab,setTab]=useState("setup"); // setup | report
  const [newName,setNewName]=useState("");
  const [newCode,setNewCode]=useState("");
  const [newContact,setNewContact]=useState("");
  const [newAddress,setNewAddress]=useState("");
  const [editing,setEditing]=useState(null);
  const [err,setErr]=useState("");
  const [saving,setSaving]=useState(false);
  const [qrMerchant,setQrMerchant]=useState(null); // merchant to show QR for

  const setMerchants = ctx.setMerchants;

  const saveMerchants=async(next)=>{
    setSaving(true);
    try{
      await window.storage.set(KEYS.merchants,JSON.stringify(next),true);
      setMerchants(next);
      showToast("Merchants saved!");
    }catch(e){showToast("Failed to save","error");}
    setSaving(false);
  };

  const addMerchant=async()=>{
    setErr("");
    if(!newName.trim()){setErr("Merchant name is required.");return;}
    if(!newCode.trim()){setErr("Merchant code is required.");return;}
    const code=newCode.trim().toUpperCase();
    if(merchants.find(m=>m.code===code)){setErr("This code already exists.");return;}
    if(!/^[A-Z0-9]{2,10}$/.test(code)){setErr("Code must be 2–10 letters/numbers only.");return;}
    const newM={id:genId(),code,name:newName.trim(),contact:newContact.trim(),address:newAddress.trim(),active:true,joinedAt:today()};
    await saveMerchants([...merchants,newM]);
    setNewName("");setNewCode("");setNewContact("");setNewAddress("");
  };

  const toggleActive=(id)=>saveMerchants(merchants.map(m=>m.id===id?{...m,active:!m.active}:m));
  const deleteMerchant=(id)=>saveMerchants(merchants.filter(m=>m.id!==id));

  const saveEdit=async()=>{
    if(!editing.name.trim()){setErr("Name required.");return;}
    setErr("");
    await saveMerchants(merchants.map(m=>m.id===editing.id?{...m,...editing}:m));
    setEditing(null);
  };

  // Report data
  const reportRows=merchants.map(m=>{
    const mems=members.filter(mb=>mb.merchantCode===m.code);
    const active=mems.filter(mb=>mb.points>0).length;
    const totalPts=mems.reduce((s,mb)=>s+mb.points,0);
    return{...m,count:mems.length,active,totalPts};
  }).sort((a,b)=>b.count-a.count);

  const totalRegistered=members.filter(m=>m.merchantCode).length;
  const untracked=members.filter(m=>!m.merchantCode).length;

  return(
    <div className="fi">
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Merchants</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Manage merchant partners and track member registrations by merchant</p>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:8,marginBottom:22}}>
        {[{id:"setup",label:"🏪 Merchant Setup"},{id:"report",label:"📊 Registration Report"}].map(t=>(
          <button key={t.id} onClick={()=>{setTab(t.id);setEditing(null);setErr("");}}
            style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,
              background:tab===t.id?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",
              color:tab===t.id?"#000":"#5566aa",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SETUP TAB ── */}
      {tab==="setup"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,alignItems:"start"}}>

        {/* Add / Edit form */}
        <div className="card" style={{padding:"24px 26px",display:"flex",flexDirection:"column",gap:16}}>
          <div style={{fontWeight:700,color:"#e8eaf0",fontSize:15}}>{editing?"✏️ Edit Merchant":"⊕ Add New Merchant"}</div>

          {[
            {key:"name",   label:"Merchant Name *",    placeholder:"e.g. Kedai Maju Sdn Bhd",  val:editing?editing.name:newName,   set:editing?(v)=>setEditing(e=>({...e,name:v})):(v)=>setNewName(v)},
            {key:"code",   label:"Merchant Code *",    placeholder:"e.g. KM01",                val:editing?editing.code:newCode,   set:editing?(v)=>setEditing(e=>({...e,code:v.toUpperCase().replace(/[^A-Z0-9]/g,"")})):(v)=>setNewCode(v.toUpperCase().replace(/[^A-Z0-9]/g,"")),mono:true,disabled:!!editing},
            {key:"contact",label:"Contact Person",     placeholder:"e.g. Ahmad 012-3456789",   val:editing?editing.contact:newContact, set:editing?(v)=>setEditing(e=>({...e,contact:v})):(v)=>setNewContact(v)},
            {key:"address",label:"Address / Outlet",   placeholder:"e.g. No 1, Jalan Maju",    val:editing?editing.address:newAddress, set:editing?(v)=>setEditing(e=>({...e,address:v})):(v)=>setNewAddress(v)},
          ].map(({key,label,placeholder,val,set,mono,disabled})=>(
            <div key={key}>
              <label className="lbl">{label}</label>
              <input className="inp" placeholder={placeholder} value={val||""}
                onChange={e=>set(e.target.value)} disabled={disabled}
                style={{fontFamily:mono?"monospace":"inherit",fontWeight:mono?700:"normal",
                  letterSpacing:mono?1:0,opacity:disabled?0.5:1}}/>
            </div>
          ))}

          {err&&<div style={{color:"#f87171",fontSize:12,background:"#2a0d0d",borderRadius:8,padding:"8px 12px"}}>{err}</div>}

          <div style={{display:"flex",gap:10}}>
            {editing
              ?<><button className="btn" onClick={saveEdit} disabled={saving} style={{opacity:saving?0.6:1}}>{saving?"Saving…":"💾 Save Changes"}</button>
                <button className="btn-g" onClick={()=>{setEditing(null);setErr("");}}>Cancel</button></>
              :<button className="btn" onClick={addMerchant} disabled={saving} style={{opacity:saving?0.6:1}}>{saving?"Saving…":"⊕ Add Merchant"}</button>
            }
          </div>

          <div style={{borderTop:"1px solid #1a2030",paddingTop:14,fontSize:12,color:"#2a3a55",lineHeight:1.8}}>
            <div style={{fontWeight:600,color:"#3a4a66",marginBottom:4}}>How it works:</div>
            <div>• Each merchant gets a unique code (e.g. <span style={{color:"#10b981",fontFamily:"monospace"}}>KM01</span>)</div>
            <div>• Admin selects the merchant when enrolling a new member</div>
            <div>• The Registration Report tracks how many members each merchant has referred</div>
          </div>
        </div>

        {/* Merchant list */}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {merchants.length===0&&<div className="card" style={{padding:"32px",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12,opacity:.3}}>🏪</div>
            <div style={{color:"#2a3a55",fontSize:13}}>No merchants yet. Add your first merchant partner.</div>
          </div>}
          {merchants.map(m=>{
            const count=members.filter(mb=>mb.merchantCode===m.code).length;
            return(
              <div key={m.id} className="card" style={{padding:"16px 18px",opacity:m.active===false?0.5:1}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                  <div style={{width:44,height:44,borderRadius:10,background:"#0d2a1a",
                    display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
                    fontSize:11,fontWeight:800,color:"#10b981",fontFamily:"monospace",letterSpacing:1}}>
                    {m.code}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,color:"#ccd",fontSize:14}}>{m.name}</div>
                    {m.contact&&<div style={{fontSize:11,color:"#445566",marginTop:2}}>👤 {m.contact}</div>}
                    {m.address&&<div style={{fontSize:11,color:"#445566",marginTop:1}}>📍 {m.address}</div>}
                    <div style={{marginTop:6,display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:12,color:"#f59e0b",fontWeight:700}}>{count} member{count!==1?"s":""}</span>
                      {m.active===false&&<span style={{fontSize:10,color:"#886644",background:"#1a1008",padding:"2px 8px",borderRadius:99,border:"1px solid #2a2010"}}>Inactive</span>}
                      <span style={{fontSize:10,color:"#2a3a55"}}>Since {m.joinedAt}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
                    <button className="btn-g" onClick={()=>setQrMerchant(m)} style={{fontSize:11,padding:"5px 10px"}}>📱 QR</button>
                    <button className="btn-g" onClick={()=>{setEditing({...m});setErr("");}} style={{fontSize:11,padding:"5px 10px"}}>✏️ Edit</button>
                    <button className="btn-g" onClick={()=>toggleActive(m.id)} style={{fontSize:11,padding:"5px 10px"}}>{m.active===false?"On":"Off"}</button>
                    {count===0&&<button className="btn-d" onClick={()=>deleteMerchant(m.id)} style={{fontSize:11,padding:"5px 10px"}}>✕</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>}

      {/* ── REPORT TAB ── */}
      {tab==="report"&&<MerchantReport members={members} merchants={merchants} tiers={ctx.tiers} totalRegistered={totalRegistered} untracked={untracked}/>}

      {/* QR Code Modal */}
      {qrMerchant&&<QRModal merchant={qrMerchant} onClose={()=>setQrMerchant(null)}/>}
    </div>
  );
}


// ─── MERCHANT BADGE ──────────────────────────────────────────────────────────
function MerchantBadge({code,name,isHome}){
  return(
    <span style={{
      display:"inline-flex",alignItems:"center",gap:4,
      fontFamily:"monospace",fontWeight:700,fontSize:11,
      color:isHome?"#10b981":"#60a5fa",
      background:isHome?"#0d2a1a":"#0d1a2a",
      border:`1px solid ${isHome?"#1a4a2a":"#1a3050"}`,
      borderRadius:6,padding:"2px 8px",
      whiteSpace:"nowrap"
    }}>
      {isHome?"🏠":""}{code}
      <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:400,opacity:.8}}>{name}</span>
    </span>
  );
}

// ─── MERCHANT REPORT ─────────────────────────────────────────────────────────
function MerchantReport({members,merchants,tiers,totalRegistered,untracked}){
  const [view,setView]=useState("dashboard");  // dashboard | summary | byMerchant | byMember
  const [selMerchant,setSelMerchant]=useState("all");
  const [selMember,setSelMember]=useState("");
  const [search,setSearch]=useState("");

  // Helper: get merchant name from code
  const mName=(code)=>merchants.find(m=>m.code===code)?.name||code||"—";

  // All award transactions across all members with merchant info
  const allAwardTxns=members.flatMap(mb=>
    (mb.transactions||[])
      .filter(t=>t.pts>0&&t.merchantCode)
      .map(t=>({
        ...t,
        memberId:mb.id,
        memberName:mb.name,
        memberPhone:mb.phone,
        memberTier:getTier(mb.points,tiers),
        registeredMerchant:mb.merchantCode,
        registeredMerchantName:mName(mb.merchantCode),
        awardMerchantName:mName(t.merchantCode),
      }))
  ).sort((a,b)=>(b.date||"").localeCompare(a.date||""));

  // Per-merchant summary
  const merchantSummary=merchants.map(m=>{
    const registered=members.filter(mb=>mb.merchantCode===m.code);
    const awardTxns=allAwardTxns.filter(t=>t.merchantCode===m.code);
    const totalPts=awardTxns.reduce((s,t)=>s+t.pts,0);
    const uniqueAwardedMembers=new Set(awardTxns.map(t=>t.memberId)).size;
    // Members registered here who also earned points at OTHER merchants
    const crossMerchant=registered.filter(mb=>
      (mb.transactions||[]).some(t=>t.pts>0&&t.merchantCode&&t.merchantCode!==m.code)
    ).length;
    return{...m,registeredCount:registered.length,awardTxns:awardTxns.length,totalPts,uniqueAwardedMembers,crossMerchant};
  }).sort((a,b)=>b.totalPts-a.totalPts);

  // Per-member report: registered merchant + all locations where they earned
  const memberReport=members.map(mb=>{
    const txns=(mb.transactions||[]).filter(t=>t.pts>0&&t.merchantCode);
    const locations=[...new Set(txns.map(t=>t.merchantCode))].map(code=>({
      code,
      name:mName(code),
      pts:txns.filter(t=>t.merchantCode===code).reduce((s,t)=>s+t.pts,0),
      count:txns.filter(t=>t.merchantCode===code).length,
      isHome:code===mb.merchantCode,
    })).sort((a,b)=>b.pts-a.pts);
    return{
      ...mb,
      tier:getTier(mb.points,tiers),
      registeredName:mName(mb.merchantCode),
      locations,
      crossMerchant:locations.filter(l=>!l.isHome).length>0,
      totalEarned:txns.reduce((s,t)=>s+t.pts,0),
    };
  }).filter(mb=>search?mb.name.toLowerCase().includes(search.toLowerCase())||mb.phone.includes(search):true);

  // Filtered by selected merchant
  const filteredMembers=selMerchant==="all"
    ?memberReport
    :memberReport.filter(mb=>mb.merchantCode===selMerchant||mb.locations.some(l=>l.code===selMerchant));

  return(
    <div>
      {/* Summary stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24}}>
        {[
          {label:"Total Merchants",   val:merchants.length,                                      color:"#60a5fa",bg:"#0d1a2a",border:"#1a3050"},
          {label:"Tracked Members",   val:totalRegistered,                                       color:"#10b981",bg:"#0d2a1a",border:"#1a4a2a"},
          {label:"Untracked Members", val:untracked,                                             color:"#f87171",bg:"#2a0d0d",border:"#4a1a1a"},
          {label:"Cross-Merchant",    val:memberReport.filter(m=>m.crossMerchant).length,        color:"#f59e0b",bg:"#1a1208",border:"#3a2a12"},
        ].map(s=>(
          <div key={s.label} className="card" style={{padding:"16px 18px",background:s.bg,border:`1px solid ${s.border}`}}>
            <div style={{fontSize:22,fontWeight:800,color:s.color,marginBottom:2}}>{s.val}</div>
            <div style={{fontSize:11,color:s.color,opacity:.6,textTransform:"uppercase",letterSpacing:.5}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* View switcher */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        {[{id:"dashboard",label:"📈 Dashboard"},{id:"summary",label:"📊 Merchant Summary"},{id:"byMerchant",label:"🏪 By Merchant"},{id:"byMember",label:"👤 By Member"}].map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)}
            style={{padding:"7px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",
              background:view===v.id?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",
              color:view===v.id?"#000":"#5566aa"}}>
            {v.label}
          </button>
        ))}
        <input className="inp" placeholder="Search member…" value={search}
          onChange={e=>setSearch(e.target.value)}
          style={{flex:1,maxWidth:220,padding:"7px 12px",fontSize:13,marginLeft:"auto"}}/>
      </div>

      {/* ── DASHBOARD VIEW ── */}
      {view==="dashboard"&&<MerchantDashboard merchants={merchants} members={members} tiers={tiers} allAwardTxns={allAwardTxns} merchantSummary={merchantSummary}/>}

      {/* ── SUMMARY VIEW ── */}
      {view==="summary"&&<div className="card" style={{overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"80px 1fr 90px 90px 100px 100px 110px",
          borderBottom:"1px solid #1a2030",padding:"12px 16px"}}>
          {["Code","Merchant","Registered","Awarded To","Txns","Pts Given","Cross-Merch"].map(h=>(
            <div key={h} style={{fontSize:10,fontWeight:600,color:"#445566",letterSpacing:.8,textTransform:"uppercase"}}>{h}</div>
          ))}
        </div>
        {merchantSummary.map((m,i)=>(
          <div key={m.id} style={{display:"grid",gridTemplateColumns:"80px 1fr 90px 90px 100px 100px 110px",
            padding:"13px 16px",borderBottom:"1px solid #0e1825",
            background:i%2===0?"#080c12":"#090d14"}}>
            <div><span style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:"#10b981",background:"#0d2a1a",padding:"3px 7px",borderRadius:6}}>{m.code}</span></div>
            <div>
              <div style={{fontSize:13,color:"#ccd",fontWeight:500}}>{m.name}</div>
              {m.contact&&<div style={{fontSize:10,color:"#445566"}}>{m.contact}</div>}
            </div>
            <div style={{display:"flex",alignItems:"center"}}><span style={{fontSize:14,fontWeight:700,color:"#f59e0b"}}>{m.registeredCount}</span></div>
            <div style={{display:"flex",alignItems:"center"}}><span style={{fontSize:14,fontWeight:700,color:"#4ade80"}}>{m.uniqueAwardedMembers}</span></div>
            <div style={{display:"flex",alignItems:"center"}}><span style={{fontSize:13,color:"#8899bb"}}>{m.awardTxns}</span></div>
            <div style={{display:"flex",alignItems:"center"}}><span style={{fontSize:14,fontWeight:700,color:"#60a5fa"}}>{m.totalPts.toLocaleString()}</span></div>
            <div style={{display:"flex",alignItems:"center"}}>
              {m.crossMerchant>0
                ?<span style={{fontSize:12,color:"#f59e0b",fontWeight:600}}>{m.crossMerchant} member{m.crossMerchant!==1?"s":""}</span>
                :<span style={{fontSize:12,color:"#2a3a55"}}>—</span>}
            </div>
          </div>
        ))}
        {merchantSummary.length===0&&<div style={{textAlign:"center",padding:"40px",color:"#2a3a55",fontSize:13}}>No merchants configured.</div>}
      </div>}

      {/* ── BY MERCHANT VIEW ── */}
      {view==="byMerchant"&&<div>
        {/* Merchant filter */}
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {[{code:"all",name:"All Merchants"},...merchants].map(m=>(
            <button key={m.code} onClick={()=>setSelMerchant(m.code)}
              style={{padding:"6px 14px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",
                background:selMerchant===m.code?"linear-gradient(135deg,#10b981,#059669)":"#0e1420",
                color:selMerchant===m.code?"#000":"#5566aa"}}>
              {m.code==="all"?"All":m.code} {m.code!=="all"&&<span style={{opacity:.7}}>({merchants.find(x=>x.code===m.code)&&members.filter(mb=>mb.merchantCode===m.code).length})</span>}
            </button>
          ))}
        </div>

        {merchants.filter(m=>selMerchant==="all"||m.code===selMerchant).map(m=>{
          const regMembers=members.filter(mb=>mb.merchantCode===m.code);
          const awardedHere=members.filter(mb=>
            (mb.transactions||[]).some(t=>t.pts>0&&t.merchantCode===m.code)&&mb.merchantCode!==m.code
          );
          return(
            <div key={m.id} className="card" style={{padding:"20px 22px",marginBottom:16}}>
              {/* Merchant header */}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,paddingBottom:14,borderBottom:"1px solid #1a2030"}}>
                <div style={{width:48,height:48,borderRadius:10,background:"#0d2a1a",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:"#10b981"}}>{m.code}</span>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:"#e8eaf0",fontSize:15}}>{m.name}</div>
                  {m.address&&<div style={{fontSize:11,color:"#445566",marginTop:2}}>📍 {m.address}</div>}
                  {m.contact&&<div style={{fontSize:11,color:"#445566"}}>👤 {m.contact}</div>}
                </div>
                <div style={{display:"flex",gap:12,textAlign:"center"}}>
                  {[
                    {val:regMembers.length,label:"Registered",color:"#f59e0b"},
                    {val:awardedHere.length,label:"Visiting",color:"#60a5fa"},
                  ].map(s=>(
                    <div key={s.label} style={{background:"#0a0f1a",borderRadius:8,padding:"8px 14px",border:"1px solid #1e2535"}}>
                      <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
                      <div style={{fontSize:10,color:"#445566",textTransform:"uppercase",letterSpacing:.5}}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Registered members */}
              {regMembers.length>0&&<div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:"#4a7a4a",letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>🏠 Registered Members ({regMembers.length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
                  {regMembers.map(mb=>{
                    const tier=getTier(mb.points,tiers);
                    const txnsHere=(mb.transactions||[]).filter(t=>t.pts>0&&t.merchantCode===m.code);
                    const ptsHere=txnsHere.reduce((s,t)=>s+t.pts,0);
                    const otherLocs=[...new Set((mb.transactions||[]).filter(t=>t.pts>0&&t.merchantCode&&t.merchantCode!==m.code).map(t=>t.merchantCode))];
                    return(
                      <div key={mb.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 1fr",gap:8,alignItems:"center",
                        padding:"10px 12px",background:"#0a0f1a",borderRadius:8,border:"1px solid #1e2535"}}>
                        <div>
                          <div style={{fontSize:13,color:"#ccd",fontWeight:600}}>{mb.name}</div>
                          <div style={{fontSize:11,color:"#445566"}}>{mb.phone} · Joined {mb.joinedAt}</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"#4ade80"}}>{ptsHere.toLocaleString()}</div>
                          <div style={{fontSize:9,color:"#445566"}}>pts here</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <span style={{fontSize:10,color:tier.color,fontWeight:700,background:`${tier.color}18`,padding:"2px 8px",borderRadius:99}}>{tier.name}</span>
                        </div>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          {otherLocs.length>0
                            ?otherLocs.map(code=><MerchantBadge key={code} code={code} name={mName(code)} isHome={false}/>)
                            :<span style={{fontSize:10,color:"#2a3a55",fontStyle:"italic"}}>No other locations</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>}

              {/* Visiting members (awarded here but not registered) */}
              {awardedHere.length>0&&<div>
                <div style={{fontSize:11,fontWeight:700,color:"#4a6a9a",letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>🔀 Visiting Members — Awarded Here ({awardedHere.length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:180,overflowY:"auto"}}>
                  {awardedHere.map(mb=>{
                    const tier=getTier(mb.points,tiers);
                    const txnsHere=(mb.transactions||[]).filter(t=>t.pts>0&&t.merchantCode===m.code);
                    const ptsHere=txnsHere.reduce((s,t)=>s+t.pts,0);
                    return(
                      <div key={mb.id} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 1fr",gap:8,alignItems:"center",
                        padding:"10px 12px",background:"#0a0f18",borderRadius:8,border:"1px solid #1a2040"}}>
                        <div>
                          <div style={{fontSize:13,color:"#ccd",fontWeight:600}}>{mb.name}</div>
                          <div style={{fontSize:11,color:"#445566"}}>{mb.phone}</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:13,fontWeight:800,color:"#60a5fa"}}>{ptsHere.toLocaleString()}</div>
                          <div style={{fontSize:9,color:"#445566"}}>pts here</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <span style={{fontSize:10,color:tier.color,fontWeight:700,background:`${tier.color}18`,padding:"2px 8px",borderRadius:99}}>{tier.name}</span>
                        </div>
                        <div>
                          <MerchantBadge code={mb.merchantCode} name={mName(mb.merchantCode)} isHome={true}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>}

              {regMembers.length===0&&awardedHere.length===0&&
                <div style={{textAlign:"center",padding:"20px",color:"#2a3a55",fontSize:13}}>No activity for this merchant yet.</div>}
            </div>
          );
        })}
      </div>}

      {/* ── BY MEMBER VIEW ── */}
      {view==="byMember"&&<div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filteredMembers.length===0&&<div className="card" style={{padding:"32px",textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:12,opacity:.3}}>👤</div>
          <div style={{color:"#2a3a55",fontSize:13}}>No members found.</div>
        </div>}
        {filteredMembers.map(mb=>(
          <div key={mb.id} className="card" style={{padding:"18px 20px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:16,alignItems:"start"}}>
              <div>
                {/* Member header */}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{fontSize:22}}>{mb.tier.icon}</span>
                  <div>
                    <div style={{fontWeight:700,color:"#e8eaf0",fontSize:14}}>{mb.name}</div>
                    <div style={{fontSize:11,color:"#445566"}}>{mb.phone} · Joined {mb.joinedAt}</div>
                  </div>
                  <span style={{fontSize:10,color:mb.tier.color,fontWeight:700,background:`${mb.tier.color}18`,padding:"2px 8px",borderRadius:99,marginLeft:4}}>{mb.tier.name}</span>
                </div>

                {/* Registered merchant */}
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 12px",background:"#0a0f1a",borderRadius:8,border:"1px solid #1e2535"}}>
                  <span style={{fontSize:11,color:"#445566",whiteSpace:"nowrap"}}>Registered at:</span>
                  {mb.merchantCode
                    ?<MerchantBadge code={mb.merchantCode} name={mb.registeredName} isHome={true}/>
                    :<span style={{fontSize:11,color:"#2a3a55",fontStyle:"italic"}}>No merchant code</span>}
                </div>

                {/* Award locations */}
                {mb.locations.length>0&&<div>
                  <div style={{fontSize:10,fontWeight:700,color:"#445566",letterSpacing:.8,textTransform:"uppercase",marginBottom:6}}>Points Awarded At:</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {mb.locations.map(loc=>(
                      <div key={loc.code} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",
                        background:loc.isHome?"#0d2a1a":"#0a0f1a",borderRadius:7,
                        border:`1px solid ${loc.isHome?"#1a4a2a":"#1e2535"}`}}>
                        <MerchantBadge code={loc.code} name={loc.name} isHome={loc.isHome}/>
                        <div style={{flex:1}}/>
                        <span style={{fontSize:12,color:"#8899bb"}}>{loc.count} txn{loc.count!==1?"s":""}</span>
                        <span style={{fontSize:13,fontWeight:800,color:loc.isHome?"#4ade80":"#60a5fa"}}>+{loc.pts.toLocaleString()} pts</span>
                      </div>
                    ))}
                  </div>
                </div>}
                {mb.locations.length===0&&<div style={{fontSize:12,color:"#2a3a55",fontStyle:"italic"}}>No points awarded yet.</div>}
              </div>

              {/* Right side stats */}
              <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:100,textAlign:"right"}}>
                <div style={{background:"#0a0f1a",borderRadius:8,padding:"10px 14px",border:"1px solid #1e2535"}}>
                  <div style={{fontSize:18,fontWeight:800,color:"#f59e0b"}}>{mb.points.toLocaleString()}</div>
                  <div style={{fontSize:9,color:"#445566",textTransform:"uppercase",letterSpacing:.5}}>Balance</div>
                </div>
                <div style={{background:"#0a0f1a",borderRadius:8,padding:"10px 14px",border:"1px solid #1e2535"}}>
                  <div style={{fontSize:18,fontWeight:800,color:"#4ade80"}}>{mb.totalEarned.toLocaleString()}</div>
                  <div style={{fontSize:9,color:"#445566",textTransform:"uppercase",letterSpacing:.5}}>Total Earned</div>
                </div>
                {mb.locations.length>1&&<div style={{background:"#1a1208",borderRadius:8,padding:"8px 12px",border:"1px solid #3a2a12"}}>
                  <div style={{fontSize:14,fontWeight:800,color:"#f59e0b"}}>{mb.locations.length}</div>
                  <div style={{fontSize:9,color:"#7a6a3a",textTransform:"uppercase",letterSpacing:.5}}>Locations</div>
                </div>}
              </div>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}


// ─── DONUT CHART ─────────────────────────────────────────────────────────────
function Donut({pct,size=80,color="#f59e0b",trackColor="#1e2535",label}){
  const r=size/2-8;const circ=2*Math.PI*r;
  const dash=circ*(pct/100);const gap=circ-dash;
  return(
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={trackColor} strokeWidth={8}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${gap}`} strokeLinecap="round"/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:size>70?16:12,fontWeight:800,color,lineHeight:1}}>{pct}%</div>
        {label&&<div style={{fontSize:9,color:"#445566",textTransform:"uppercase",letterSpacing:.5,marginTop:2}}>{label}</div>}
      </div>
    </div>
  );
}

// ─── SPLIT BAR ───────────────────────────────────────────────────────────────
function SplitBar({homePct,visitingPct}){
  return(
    <div style={{height:12,borderRadius:99,overflow:"hidden",background:"#1e2535",display:"flex"}}>
      <div style={{width:`${homePct}%`,background:"#10b981",transition:"width .4s ease"}}/>
      <div style={{width:`${visitingPct}%`,background:"#f59e0b",transition:"width .4s ease"}}/>
    </div>
  );
}

// ─── MERCHANT DASHBOARD ───────────────────────────────────────────────────────
function MerchantDashboard({merchants,members,tiers,allAwardTxns,merchantSummary}){
  const [selCode,setSelCode]=useState("all");
  const isAll=selCode==="all";

  // Per-merchant computed data
  const merchantData=merchantSummary.map(m=>{
    const regAndSpentHere=members.filter(mb=>
      mb.merchantCode===m.code&&(mb.transactions||[]).some(t=>t.pts>0&&t.merchantCode===m.code)
    ).length;
    const notRegButSpentHere=members.filter(mb=>
      mb.merchantCode!==m.code&&(mb.transactions||[]).some(t=>t.pts>0&&t.merchantCode===m.code)
    ).length;
    const totalSpenders=regAndSpentHere+notRegButSpentHere;
    const visitingPct=totalSpenders>0?Math.round((notRegButSpentHere/totalSpenders)*100):0;
    const homePct=totalSpenders>0?Math.round((regAndSpentHere/totalSpenders)*100):0;
    const ptsFromReg=allAwardTxns.filter(t=>t.merchantCode===m.code&&members.find(mb=>mb.id===t.memberId)?.merchantCode===m.code).reduce((s,t)=>s+t.pts,0);
    const ptsFromVisiting=allAwardTxns.filter(t=>t.merchantCode===m.code&&members.find(mb=>mb.id===t.memberId)?.merchantCode!==m.code).reduce((s,t)=>s+t.pts,0);
    return{...m,regAndSpentHere,notRegButSpentHere,totalSpenders,visitingPct,homePct,ptsFromReg,ptsFromVisiting};
  });

  // Active filter data — drives BOTH KPI row and cards
  const filtered=isAll?merchantData:merchantData.filter(m=>m.code===selCode);
  const selectedMerchant=isAll?null:merchants.find(m=>m.code===selCode);

  // Aggregate KPIs from filtered set
  const kpiSpenders=filtered.reduce((s,m)=>s+m.totalSpenders,0);
  const kpiVisiting=filtered.reduce((s,m)=>s+m.notRegButSpentHere,0);
  const kpiHome=filtered.reduce((s,m)=>s+m.regAndSpentHere,0);
  const kpiVisitingPct=kpiSpenders>0?Math.round((kpiVisiting/kpiSpenders)*100):0;
  const kpiHomePct=kpiSpenders>0?Math.round((kpiHome/kpiSpenders)*100):0;
  const kpiPtsHome=filtered.reduce((s,m)=>s+m.ptsFromReg,0);
  const kpiPtsVisiting=filtered.reduce((s,m)=>s+m.ptsFromVisiting,0);
  const kpiPtsAll=kpiPtsHome+kpiPtsVisiting;

  return(
    <div>
      {/* Merchant filter — ABOVE everything so it controls all KPIs */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center",
        background:"#0a0f1a",borderRadius:12,padding:"12px 16px",border:"1px solid #1e2535"}}>
        <span style={{fontSize:11,color:"#445566",textTransform:"uppercase",letterSpacing:.8,marginRight:4}}>View:</span>
        <button onClick={()=>setSelCode("all")}
          style={{padding:"7px 18px",borderRadius:8,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",
            background:isAll?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",
            color:isAll?"#000":"#5566aa",transition:"all .15s"}}>
          🌐 All Merchants
        </button>
        {merchants.map(m=>(
          <button key={m.code} onClick={()=>setSelCode(m.code)}
            style={{padding:"7px 16px",borderRadius:8,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",
              background:selCode===m.code?"linear-gradient(135deg,#10b981,#059669)":"#0e1420",
              color:selCode===m.code?"#000":"#5566aa",transition:"all .15s",
              display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontFamily:"monospace",fontSize:11}}>{m.code}</span>
            <span style={{opacity:.7,fontWeight:400,fontSize:11}}>{m.name}</span>
          </button>
        ))}
      </div>

      {/* Context header when a specific merchant is selected */}
      {selectedMerchant&&<div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20,
        padding:"14px 18px",background:"#0d2a1a",borderRadius:12,border:"1px solid #1a4a2a"}}>
        <div style={{width:48,height:48,borderRadius:10,background:"#0a1a0a",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,color:"#10b981"}}>{selectedMerchant.code}</span>
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,color:"#e8eaf0",fontSize:16}}>{selectedMerchant.name}</div>
          <div style={{display:"flex",gap:16,marginTop:4,flexWrap:"wrap"}}>
            {selectedMerchant.address&&<span style={{fontSize:11,color:"#4a7a4a"}}>📍 {selectedMerchant.address}</span>}
            {selectedMerchant.contact&&<span style={{fontSize:11,color:"#4a7a4a"}}>👤 {selectedMerchant.contact}</span>}
            <span style={{fontSize:11,color:"#4a7a4a"}}>Since {selectedMerchant.joinedAt}</span>
          </div>
        </div>
        <div style={{fontSize:11,color:"#4a7a4a",background:"#0a1a0a",borderRadius:8,padding:"6px 12px",border:"1px solid #1a3a1a"}}>
          Showing data for this merchant only
        </div>
      </div>}

      {/* KPI row — always reflects selected filter */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,marginBottom:24}}>
        {/* Visiting donut */}
        <div className="card" style={{padding:"24px",display:"flex",alignItems:"center",gap:20,background:"#0e1420",border:"1px solid #1e2535"}}>
          <Donut pct={kpiVisitingPct} size={90} color="#f59e0b" label="visiting"/>
          <div>
            <div style={{fontSize:12,color:"#445566",marginBottom:4}}>
              {isAll?"Cross-Merchant Spend":"Visiting (Not Registered Here)"}
            </div>
            <div style={{fontSize:26,fontWeight:800,color:"#f59e0b"}}>{kpiVisiting}</div>
            <div style={{fontSize:11,color:"#445566",marginTop:2,lineHeight:1.5}}>
              {isAll?"members spending at a merchant they're not registered at"
                    :"members awarded here but registered elsewhere"}
            </div>
          </div>
        </div>
        {/* Home donut */}
        <div className="card" style={{padding:"24px",display:"flex",alignItems:"center",gap:20,background:"#0d2a1a",border:"1px solid #1a4a2a"}}>
          <Donut pct={kpiHomePct} size={90} color="#10b981" label="home"/>
          <div>
            <div style={{fontSize:12,color:"#4a7a4a",marginBottom:4}}>
              {isAll?"Home Members Spending":"Registered Here & Spending"}
            </div>
            <div style={{fontSize:26,fontWeight:800,color:"#10b981"}}>{kpiHome}</div>
            <div style={{fontSize:11,color:"#4a7a4a",marginTop:2,lineHeight:1.5}}>
              {isAll?"members spending at their own registered merchant"
                    :"members registered here AND awarded pts here"}
            </div>
          </div>
        </div>
        {/* Points split */}
        <div className="card" style={{padding:"24px",background:"#0a0f1a",border:"1px solid #1e2535"}}>
          <div style={{fontSize:12,color:"#445566",marginBottom:14}}>
            Points Split — {isAll?"All Merchants":selectedMerchant?.name}
          </div>
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:11,color:"#10b981"}}>🏠 Home</span>
              <span style={{fontSize:11,color:"#10b981",fontWeight:700}}>{kpiPtsAll>0?Math.round(kpiPtsHome/kpiPtsAll*100):0}%</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:11,color:"#f59e0b"}}>🔀 Visiting</span>
              <span style={{fontSize:11,color:"#f59e0b",fontWeight:700}}>{kpiPtsAll>0?Math.round(kpiPtsVisiting/kpiPtsAll*100):0}%</span>
            </div>
            <SplitBar homePct={kpiPtsAll>0?Math.round(kpiPtsHome/kpiPtsAll*100):0}
                      visitingPct={kpiPtsAll>0?Math.round(kpiPtsVisiting/kpiPtsAll*100):0}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div style={{background:"#0d2a1a",borderRadius:8,padding:"8px 10px"}}>
              <div style={{fontSize:15,fontWeight:800,color:"#10b981"}}>{kpiPtsHome.toLocaleString()}</div>
              <div style={{fontSize:9,color:"#4a7a4a",textTransform:"uppercase",letterSpacing:.5}}>Home pts</div>
            </div>
            <div style={{background:"#1a1208",borderRadius:8,padding:"8px 10px"}}>
              <div style={{fontSize:15,fontWeight:800,color:"#f59e0b"}}>{kpiPtsVisiting.toLocaleString()}</div>
              <div style={{fontSize:9,color:"#7a6a3a",textTransform:"uppercase",letterSpacing:.5}}>Visiting pts</div>
            </div>
          </div>
        </div>
      </div>

      {/* Overall insight when all selected */}
      {isAll&&kpiSpenders>0&&<div style={{marginBottom:20,padding:"14px 18px",borderRadius:10,
        background:kpiVisitingPct>=50?"#1a1000":"#0a1a0a",
        border:`1px solid ${kpiVisitingPct>=50?"#3a2800":"#1a3a1a"}`}}>
        <span style={{fontSize:13,color:kpiVisitingPct>=50?"#f59e0b":"#4ade80",lineHeight:1.6}}>
          {kpiVisitingPct>=50
            ?`💡 Overall, ${kpiVisitingPct}% of point-earning members are spending at merchants they didn't register with. This indicates strong cross-merchant engagement — consider referral incentives to improve registration attribution.`
            :`✓ ${kpiHomePct}% of members earn points at their registered merchant. Cross-merchant spend is ${kpiVisitingPct}%, showing healthy loyalty to home merchants.`}
        </span>
      </div>}

      {/* Per-merchant detail cards */}
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {filtered.map(m=>(
          <div key={m.id} className="card" style={{padding:"20px 22px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:16,alignItems:"center",marginBottom:m.totalSpenders>0?18:0}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:44,height:44,borderRadius:10,background:"#0d2a1a",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:"#10b981"}}>{m.code}</span>
                </div>
                <div>
                  <div style={{fontWeight:700,color:"#e8eaf0",fontSize:14}}>{m.name}</div>
                  {m.address&&<div style={{fontSize:11,color:"#445566",marginTop:1}}>📍 {m.address}</div>}
                </div>
              </div>
              {m.totalSpenders===0
                ?<div style={{fontSize:12,color:"#2a3a55",fontStyle:"italic"}}>No point activity yet</div>
                :<div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <div style={{textAlign:"center"}}>
                    <Donut pct={m.homePct} size={64} color="#10b981"/>
                    <div style={{fontSize:9,color:"#4a7a4a",marginTop:2}}>Home</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <Donut pct={m.visitingPct} size={64} color="#f59e0b"/>
                    <div style={{fontSize:9,color:"#7a6a3a",marginTop:2}}>Visiting</div>
                  </div>
                </div>
              }
            </div>

            {m.totalSpenders>0&&<div>
              <div style={{marginBottom:10}}>
                <SplitBar homePct={m.homePct} visitingPct={m.visitingPct}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div style={{background:"#0d2a1a",borderRadius:10,padding:"12px 14px",border:"1px solid #1a4a2a"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div>
                      <div style={{fontSize:10,color:"#4a7a4a",fontWeight:700,letterSpacing:.8,textTransform:"uppercase"}}>🏠 Registered Here</div>
                      <div style={{fontSize:10,color:"#2a5a2a",marginTop:2}}>Spent at own merchant</div>
                    </div>
                    <div style={{fontSize:22,fontWeight:800,color:"#10b981"}}>{m.homePct}%</div>
                  </div>
                  <div style={{display:"flex",gap:12}}>
                    <div><div style={{fontSize:14,fontWeight:700,color:"#4ade80"}}>{m.regAndSpentHere}</div><div style={{fontSize:9,color:"#4a7a4a"}}>members</div></div>
                    <div><div style={{fontSize:14,fontWeight:700,color:"#4ade80"}}>{m.ptsFromReg.toLocaleString()}</div><div style={{fontSize:9,color:"#4a7a4a"}}>pts awarded</div></div>
                  </div>
                </div>
                <div style={{background:"#1a1208",borderRadius:10,padding:"12px 14px",border:"1px solid #3a2a12"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div>
                      <div style={{fontSize:10,color:"#8a6a2a",fontWeight:700,letterSpacing:.8,textTransform:"uppercase"}}>🔀 Not Registered Here</div>
                      <div style={{fontSize:10,color:"#5a4a1a",marginTop:2}}>Registered elsewhere</div>
                    </div>
                    <div style={{fontSize:22,fontWeight:800,color:"#f59e0b"}}>{m.visitingPct}%</div>
                  </div>
                  <div style={{display:"flex",gap:12}}>
                    <div><div style={{fontSize:14,fontWeight:700,color:"#f59e0b"}}>{m.notRegButSpentHere}</div><div style={{fontSize:9,color:"#8a6a2a"}}>members</div></div>
                    <div><div style={{fontSize:14,fontWeight:700,color:"#f59e0b"}}>{m.ptsFromVisiting.toLocaleString()}</div><div style={{fontSize:9,color:"#8a6a2a"}}>pts awarded</div></div>
                  </div>
                </div>
              </div>
              {m.visitingPct>=50&&<div style={{marginTop:10,background:"#1a1000",border:"1px solid #3a2800",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#f59e0b",lineHeight:1.6}}>
                💡 <strong>{m.visitingPct}%</strong> of members earning here are not registered under <strong>{m.name}</strong>. Consider a referral incentive.
              </div>}
              {m.visitingPct>0&&m.visitingPct<50&&<div style={{marginTop:10,background:"#0a1a0a",border:"1px solid #1a3a1a",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#4ade80",lineHeight:1.6}}>
                ✓ Majority of spenders ({m.homePct}%) are registered members. <strong>{m.visitingPct}%</strong> are visiting from other merchants.
              </div>}
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}
// ─── QR MODAL ────────────────────────────────────────────────────────────────
function QRModal({merchant,onClose}){
  const MEMBER_BASE="https://sasbigpos.github.io/loyaltyapp/member/";
  const [customUrl,setCustomUrl]=useState(MEMBER_BASE);
  const [editing,setEditing]=useState(false);
  const [copied,setCopied]=useState(false);

  // Clean URL: remove trailing slashes, add exactly one, then query string
  const regUrl=customUrl.replace(/\/+$/,"")+"/?mc="+merchant.code;
  const qrSrc="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data="+encodeURIComponent(regUrl)+"&bgcolor=ffffff&color=000000&qzone=2&format=png";
  const qrSrcFallback="https://chart.googleapis.com/chart?chs=240x240&cht=qr&chl="+encodeURIComponent(regUrl)+"&choe=UTF-8";

  const copyUrl=()=>{
    navigator.clipboard?.writeText(regUrl)
      .then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);})
      .catch(()=>{
        // Fallback for browsers without clipboard API
        const ta=document.createElement("textarea");
        ta.value=regUrl;document.body.appendChild(ta);ta.select();
        document.execCommand("copy");document.body.removeChild(ta);
        setCopied(true);setTimeout(()=>setCopied(false),2000);
      });
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:9999,padding:20}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="si card" style={{padding:"28px",maxWidth:420,width:"100%",
        background:"#0e1420",border:"1px solid #1e2535",position:"relative",maxHeight:"90vh",overflowY:"auto"}}>
        <button onClick={onClose}
          style={{position:"absolute",top:14,right:14,background:"#1a2535",border:"none",
            color:"#5566aa",borderRadius:"50%",width:30,height:30,fontSize:15,cursor:"pointer",lineHeight:"30px"}}>✕</button>

        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,color:"#e8eaf0",fontWeight:700,marginBottom:4}}>
            Registration QR Code
          </div>
          <div style={{fontSize:12,color:"#445566"}}>Member scans this to register under {merchant.name}</div>
        </div>

        {/* Merchant badge */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,
          padding:"10px 14px",background:"#0d2a1a",borderRadius:10,border:"1px solid #1a4a2a"}}>
          <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:"#10b981",
            background:"#0a1a0a",padding:"3px 8px",borderRadius:6}}>{merchant.code}</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,color:"#ccd",fontSize:13}}>{merchant.name}</div>
            {merchant.address&&<div style={{fontSize:10,color:"#4a7a4a"}}>📍 {merchant.address}</div>}
          </div>
        </div>

        {/* Base URL config */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:10,color:"#445566",textTransform:"uppercase",letterSpacing:.8,marginBottom:6,
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>Member Portal Base URL</span>
            <button onClick={()=>setEditing(e=>!e)}
              style={{background:"none",border:"none",color:"#5566aa",fontSize:11,cursor:"pointer",textDecoration:"underline"}}>
              {editing?"Done":"Edit"}
            </button>
          </div>
          {editing
            ?<input className="inp" value={customUrl} onChange={e=>setCustomUrl(e.target.value)}
               style={{fontSize:12,padding:"8px 10px"}}
               placeholder="https://sasbigpos.github.io/loyaltyapp/member/"/>
            :<div style={{background:"#080c12",borderRadius:8,padding:"8px 12px",border:"1px solid #1e2535",
               fontSize:11,color:"#4a7a5a",wordBreak:"break-all",fontFamily:"monospace",lineHeight:1.5}}>
               {customUrl}
             </div>
          }
          <div style={{fontSize:10,color:"#2a3a55",marginTop:4}}>
            This must match your deployed member portal URL. Click Edit to change if needed.
          </div>
        </div>

        {/* Full registration URL */}
        <div style={{marginBottom:16,background:"#080c12",borderRadius:8,padding:"10px 12px",
          border:"1px solid #1a3a1a"}}>
          <div style={{fontSize:10,color:"#4a7a4a",marginBottom:4,fontWeight:600}}>REGISTRATION LINK</div>
          <div style={{fontSize:11,color:"#10b981",wordBreak:"break-all",fontFamily:"monospace",lineHeight:1.6}}>
            {regUrl}
          </div>
        </div>

        {/* QR Code */}
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{display:"inline-block",padding:12,background:"#ffffff",borderRadius:12,
            border:"2px solid #1a4a2a",boxShadow:"0 4px 20px #10b98122"}}>
            <img src={qrSrc} alt={"QR-"+merchant.code} width={200} height={200}
              onError={e=>{e.target.onerror=null;e.target.src=qrSrcFallback;}}
              style={{display:"block",background:"#fff"}}/>
          </div>
          <div style={{fontSize:10,color:"#2a3a55",marginTop:8}}>Scan with phone camera to open registration form</div>
        </div>

        {/* Action buttons */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <button className="btn" onClick={copyUrl}
            style={{fontSize:12,padding:"10px",background:copied?"linear-gradient(135deg,#10b981,#059669)":"linear-gradient(135deg,#f59e0b,#f97316)"}}>
            {copied?"✓ Copied!":"📋 Copy Link"}
          </button>
          <a href={regUrl} target="_blank" rel="noreferrer"
            style={{display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:12,padding:"10px",borderRadius:8,background:"#0e1420",
              border:"1px solid #1e2535",color:"#60a5fa",textDecoration:"none",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>
            🔗 Test Link
          </a>
        </div>
        <button onClick={()=>{
            const link=document.createElement("a");
            link.href="https://api.qrserver.com/v1/create-qr-code/?size=600x600&data="+encodeURIComponent(regUrl)+"&bgcolor=ffffff&color=000000&qzone=2&format=png";
            link.download="QR-"+merchant.code+".png";
            link.target="_blank";
            document.body.appendChild(link);link.click();document.body.removeChild(link);
          }}
          style={{width:"100%",padding:"10px",background:"#0e1420",border:"1px solid #1e2535",
            borderRadius:8,color:"#8899bb",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          ⬇ Download QR Image
        </button>

        <div style={{marginTop:12,fontSize:10,color:"#2a3a55",textAlign:"center",lineHeight:1.6}}>
          Merchant code <span style={{color:"#10b981",fontFamily:"monospace",fontWeight:700}}>{merchant.code}</span> is pre-filled and hidden from the member when they register via this QR.
        </div>
      </div>
    </div>
  );
}