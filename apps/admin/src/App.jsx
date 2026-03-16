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
const SEED_MEMBERS = [
  { id:"m001", name:"Aisha Rahman", phone:"012-3456-789", pin:"1234", birthday:"1990-03-15", points:3200, referredBy:null,   joinedAt:"2024-01-10", referralCode:"AISHA-2024",
    transactions:[{id:"t1a",pts:500,icon:"🍽️",label:"Weekend Dining",date:"Mar 08",type:"earn"},{id:"t1b",pts:200,icon:"👥",label:"Referral Bonus",date:"Mar 05",type:"earn"},{id:"t1c",pts:-150,icon:"🎁",label:"Free Dessert",date:"Mar 01",type:"redeem"},{id:"t1d",pts:800,icon:"🎂",label:"Birthday Campaign",date:"Feb 22",type:"earn"},{id:"t1e",pts:1850,icon:"⭐",label:"Welcome Bonus",date:"Jan 10",type:"earn"}]},
  { id:"m002", name:"Daniel Tan",   phone:"016-8877-001", pin:"1234", birthday:"1988-07-22", points:720,  referredBy:"m001", joinedAt:"2024-02-14", referralCode:"DTAN-5528",
    transactions:[{id:"t2a",pts:720,icon:"⭐",label:"Welcome + First Purchase",date:"Feb 14",type:"earn"}]},
  { id:"m003", name:"Priya Nair",   phone:"011-2345-678", pin:"1234", birthday:"1995-03-08", points:1680, referredBy:"m001", joinedAt:"2024-03-01", referralCode:"PNAIR-889",
    transactions:[{id:"t3a",pts:1680,icon:"⭐",label:"Welcome + Monthly Spend",date:"Mar 01",type:"earn"}]},
  { id:"m004", name:"Kevin Lim",    phone:"017-5544-332", pin:"1234", birthday:"1992-11-30", points:210,  referredBy:"m002", joinedAt:"2024-04-05", referralCode:"KLIM-221",
    transactions:[{id:"t4a",pts:210,icon:"⭐",label:"Welcome Bonus",date:"Apr 05",type:"earn"}]},
];

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
function getDownline(members,rootId,maxDepth){
  const tree={};
  members.forEach(m=>{if(m.referredBy)tree[m.referredBy]=[...(tree[m.referredBy]||[]),m.id];});
  const walk=(id,d)=>{if(d>maxDepth)return[];return(tree[id]||[]).flatMap(cid=>[{id:cid,level:d},...walk(cid,d+1)]);};
  return walk(rootId,1);
}

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────
const KEYS = { members:"lc:members", tiers:"lc:tiers", refLevels:"lc:refLevels", adminPw:"lc:adminPw", waTemplates:"lc:waTemplates" };

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
        const [mr,tr,rr,pr,wr] = await Promise.all([
          safeGet(KEYS.members),
          safeGet(KEYS.tiers),
          safeGet(KEYS.refLevels),
          safeGet(KEYS.adminPw),
          safeGet(KEYS.waTemplates),
        ]);
        if(pr) setAdminPw(pr.value);
        if(wr) setWaTemplates(JSON.parse(wr.value));
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

  // Award points + cascade referral overrides
  const awardPoints = (memberId, basePts, note, icon="◆") => {
    setMembers(prev=>{
      const member=prev.find(m=>m.id===memberId); if(!member) return prev;
      const tier=getTier(member.points,tiers);
      const effective=Math.round(basePts*tier.multiplier);
      const ancs=getAncestors(prev,memberId,refLevels.length);
      const overrideMap={};
      ancs.forEach(a=>{const rl=refLevels.find(r=>r.level===a.level);if(rl)overrideMap[a.id]=(overrideMap[a.id]||0)+Math.round(effective*rl.overridePercent/100);});
      return prev.map(m=>{
        if(m.id===memberId) return {...m,points:m.points+effective,transactions:[{id:genId(),pts:effective,icon,label:note,date:today(),type:"earn"},...m.transactions]};
        if(overrideMap[m.id]) return {...m,points:m.points+overrideMap[m.id],transactions:[{id:genId(),pts:overrideMap[m.id],icon:"◈",label:`Override: ${member.name}`,date:today(),type:"earn"},...m.transactions]};
        return m;
      });
    });
  };

  const enrollMember = (name,phone,referredBy,pin="0000",birthday="") => {
    const id=genId();
    const code=name.split(" ")[0].toUpperCase()+"-"+Math.floor(1000+Math.random()*9000);
    const newM={id,name,phone,pin,birthday,points:100,referredBy:referredBy||null,joinedAt:new Date().toISOString().slice(0,10),referralCode:code,
      transactions:[{id:genId(),pts:100,icon:"⭐",label:"Welcome Bonus",date:today(),type:"earn"}]};
    setMembers(prev=>[...prev,newM]);
    return newM;
  };

  if(!pwReady) return (
    <div style={{minHeight:"100vh",background:"#080c12",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,background:"linear-gradient(135deg,#f59e0b,#f97316)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:16}}>LOYALCORE</div>
        <div style={{width:32,height:32,border:"3px solid #1e2535",borderTop:"3px solid #f59e0b",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto"}}/>
      </div>
    </div>
  );
  if(!authed) return <AdminLogin storedPw={adminPw} onAuth={()=>setAuthed(true)}/>;

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#080c12",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,background:"linear-gradient(135deg,#f59e0b,#f97316)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:16}}>LOYALCORE</div>
        <div style={{width:32,height:32,border:"3px solid #1e2535",borderTop:"3px solid #f59e0b",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto"}}/>
        <div style={{color:"#445566",fontSize:13,marginTop:16,fontFamily:"'DM Sans',sans-serif"}}>Loading shared data…</div>
      </div>
    </div>
  );

  const ctx={members,tiers,refLevels,setMembers,setTiers,setRefLevels,awardPoints,enrollMember,showToast,adminPw,setAdminPw,waTemplates,setWaTemplates};

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
        .inp{background:#0a0f1a;border:1px solid #1e2535;border-radius:10px;color:#e8eaf0;padding:11px 14px;font-size:14px;font-family:'DM Sans',sans-serif;width:100%;transition:border-color .2s;}
        .inp:focus{border-color:#f59e0b66;}
        .lbl{font-size:11px;font-weight:600;color:#6677aa;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px;display:block;}
        .nav{padding:10px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s;display:flex;align-items:center;gap:9px;color:#6677aa;}
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
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,background:"linear-gradient(135deg,#f59e0b,#f97316)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>LOYALCORE</div>
            <SyncDot syncing={syncing}/>
          </div>
          <div style={{fontSize:9,color:"#2a3a4a",letterSpacing:2,textTransform:"uppercase"}}>Admin Portal</div>
        </div>
        {[{id:"dashboard",icon:"◈",label:"Dashboard"},{id:"members",icon:"◉",label:"Members"},{id:"enroll",icon:"⊕",label:"Enroll Member"},{id:"points",icon:"◆",label:"Award Points"},{id:"deduct",icon:"◇",label:"Deduct Points"},{id:"whatsapp",icon:"💬",label:"WhatsApp Blast"},{id:"config",icon:"◎",label:"Configuration"}].map(n=>(
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
        {view==="deduct"    && <DeductPts  ctx={ctx}/>}
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
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:36,fontWeight:900,background:"linear-gradient(135deg,#f59e0b,#f97316)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:-1}}>LOYALCORE</div>
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
              <td style={{padding:"14px 20px",color:"#f59e0b",fontSize:12}}>{m.birthday?new Date(m.birthday+"T00:00:00").toLocaleDateString("en-MY",{day:"2-digit",month:"short"}):<span style={{color:"#2a3a55"}}>—</span>}</td>
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
  const {members,enrollMember,showToast}=ctx;
  const [form,setForm]=useState({name:"",phone:"",ref:"",pin:"",birthday:""});
  const [err,setErr]=useState({});
  const submit=()=>{
    const e={};
    if(!form.name.trim())e.name="Name required";
    if(form.phone.replace(/\D/g,"").length<10)e.phone="Valid phone required";
    if(form.pin&&!/^\d{4}$/.test(form.pin))e.pin="PIN must be exactly 4 digits";
    if(Object.keys(e).length){setErr(e);return;}
    const pin=form.pin||"0000";
    const m=enrollMember(form.name.trim(),form.phone,form.ref||null,pin,form.birthday||"");
    showToast(`${m.name} enrolled! PIN: ${pin}`);
    setForm({name:"",phone:"",ref:"",pin:"",birthday:""});setErr({});
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
        <input className="inp" type="date" value={form.birthday} onChange={e=>setForm(f=>({...f,birthday:e.target.value}))}
          style={{colorScheme:"dark"}}/>
        <div style={{fontSize:11,color:"#445566",marginTop:5}}>Used for birthday month WhatsApp campaigns</div>
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
  const {members,tiers,refLevels,awardPoints,showToast}=ctx;
  const [sel,setSel]=useState("");const [raw,setRaw]=useState("");const [note,setNote]=useState("");
  const member=members.find(m=>m.id===sel);
  const preview=()=>{
    if(!member||!raw)return null;
    const tier=getTier(member.points,tiers);const base=parseInt(raw)||0;const eff=Math.round(base*tier.multiplier);
    const ancs=getAncestors(members,member.id,refLevels.length);
    const ov=ancs.map(a=>{const rl=refLevels.find(r=>r.level===a.level);const am=members.find(m=>m.id===a.id);return rl?{level:rl.level,pct:rl.overridePercent,pts:Math.round(eff*rl.overridePercent/100),name:am?.name,color:rl.color}:null;}).filter(Boolean);
    return {base,eff,tier,ov};
  };
  const pv=preview();
  const award=()=>{if(!member||!raw)return;awardPoints(member.id,parseInt(raw)||0,note||"Manual Award");showToast(`Points awarded to ${member.name}! Syncing to member portal…`);setSel("");setRaw("");setNote("");};
  return <div className="fi" style={{maxWidth:580}}>
    <div style={{marginBottom:28}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Award Points</h1>
      <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Multiplied by tier · Referral overrides cascade upward · Synced live</p>
    </div>
    <div className="card" style={{padding:"28px 30px",display:"flex",flexDirection:"column",gap:18}}>
      <div>
        <label className="lbl">Select Member</label>
        <select className="inp" value={sel} onChange={e=>setSel(e.target.value)}>
          <option value="">— Choose member —</option>
          {members.map(m=>{const t=getTier(m.points,tiers);return <option key={m.id} value={m.id}>{m.name} · {t.name} · {m.points} pts</option>;})}
        </select>
      </div>
      {member&&<div style={{background:"#0a1020",borderRadius:10,padding:"12px 16px",border:"1px solid #1a2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontWeight:700,color:"#ccd",fontSize:15}}>{member.name}</div><div style={{color:"#6677aa",fontSize:12,marginTop:2}}>{member.phone}</div></div>
        <div style={{textAlign:"right"}}><TierBadge tier={getTier(member.points,tiers)}/><div style={{fontSize:12,color:"#6677aa",marginTop:4}}>×{getTier(member.points,tiers).multiplier}</div></div>
      </div>}
      <div><label className="lbl">Base Points</label><input className="inp" type="number" min="1" placeholder="200" value={raw} onChange={e=>setRaw(e.target.value)}/></div>
      <div><label className="lbl">Note</label><input className="inp" placeholder="e.g. Monthly purchase" value={note} onChange={e=>setNote(e.target.value)}/></div>
      {pv&&<div style={{background:"#0d1a10",border:"1px solid #1a3a1a",borderRadius:12,padding:"16px 18px"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#4ade80",letterSpacing:.8,marginBottom:12,textTransform:"uppercase"}}>Preview</div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{color:"#6a9a6a",fontSize:13}}>Base</span><span style={{color:"#ccd",fontWeight:600}}>{pv.base.toLocaleString()}</span></div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{color:"#6a9a6a",fontSize:13}}>{pv.tier.name} ×{pv.tier.multiplier}</span><span style={{color:pv.tier.color,fontWeight:700}}>{pv.eff.toLocaleString()} pts</span></div>
        {pv.ov.length>0&&<><div style={{borderTop:"1px solid #1a3a1a",margin:"8px 0",paddingTop:8,fontSize:11,color:"#4a7a4a",textTransform:"uppercase",letterSpacing:.8}}>Referral Overrides</div>
          {pv.ov.map((o,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{color:"#6a9a6a",fontSize:13}}>L{o.level}: {o.name} ({o.pct}%)</span><span style={{color:o.color,fontWeight:600}}>+{o.pts}</span></div>)}
        </>}
      </div>}
      <button className="btn" onClick={award} disabled={!sel||!raw}>◆ Award Points</button>
    </div>
  </div>;
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function Profile({ctx,memberId,onBack}){
  const {members,tiers,refLevels,setMembers,showToast}=ctx;
  const [resetPin,setResetPin]=useState("");
  const [showReset,setShowReset]=useState(false);
  const [showBday,setShowBday]=useState(false);
  const [editBday,setEditBday]=useState(member?.birthday||"");
  const member=members.find(m=>m.id===memberId);if(!member)return null;
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
          {[{l:"Phone",v:member.phone},{l:"Member ID",v:member.id},{l:"Date of Birth",v:member.birthday?new Date(member.birthday+"T00:00:00").toLocaleDateString("en-MY",{day:"2-digit",month:"long",year:"numeric"}):"Not set"},{l:"Joined",v:member.joinedAt},{l:"Referral Code",v:member.referralCode||"—"},{l:"Referred By",v:referrer?referrer.name:"—"},{l:"Member PIN",v:member.pin||"0000"}].map(r=>(
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
      <div className="card" style={{padding:"24px 26px"}}>
        <div style={{fontWeight:700,color:"#ccd",marginBottom:16,fontSize:15}}>Transactions</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
          {member.transactions.map(t=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",background:"#0a1020",borderRadius:8,border:"1px solid #1a2030"}}>
              <div><div style={{fontSize:13,color:"#ccd",fontWeight:500}}>{t.label}</div><div style={{fontSize:11,color:"#445566",marginTop:2}}>{t.date}</div></div>
              <div style={{color:t.pts>0?"#4ade80":"#f87171",fontWeight:700,fontSize:14}}>{t.pts>0?"+":""}{t.pts.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
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
              <div style={{fontSize:12,color:"#445566",marginTop:2}}>{member.birthday?new Date(member.birthday+"T00:00:00").toLocaleDateString("en-MY",{day:"2-digit",month:"long",year:"numeric"}):<span style={{color:"#2a3a55"}}>Not set</span>}</div>
            </div>
            <button className="btn-g" onClick={()=>setShowBday(s=>!s)} style={{fontSize:12}}>{showBday?"Cancel":"Edit"}</button>
          </div>
          {showBday&&<div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
            <div style={{flex:1}}>
              <label className="lbl">Date of Birth</label>
              <input className="inp" type="date" value={editBday} onChange={e=>setEditBday(e.target.value)} style={{colorScheme:"dark"}}/>
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

// ─── DEDUCT POINTS ────────────────────────────────────────────────────────────
// Deducts points from a single member only — no referral cascade.
function DeductPts({ctx}){
  const {members,tiers,setMembers,showToast}=ctx;
  const [sel,setSel]=useState("");
  const [raw,setRaw]=useState("");
  const [note,setNote]=useState("");
  const [confirm,setConfirm]=useState(false);
  const member=members.find(m=>m.id===sel);
  const tier=member?getTier(member.points,tiers):null;
  const pts=Math.min(parseInt(raw)||0, member?.points||0);
  const remaining=member?member.points-pts:0;

  const reset=()=>{setSel("");setRaw("");setNote("");setConfirm(false);};

  const doDeduct=()=>{
    if(!member||pts<=0)return;
    const label=note||"Point Deduction";
    setMembers(prev=>prev.map(m=>m.id===member.id
      ?{...m,points:m.points-pts,transactions:[{id:genId(),pts:-pts,icon:"◇",label,date:today(),type:"redeem"},...m.transactions]}
      :m
    ));
    showToast(`${pts.toLocaleString()} pts deducted from ${member.name}.`);
    reset();
  };

  return <div className="fi" style={{maxWidth:520}}>
    <div style={{marginBottom:28}}>
      <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>Deduct Points</h1>
      <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Deducts directly from the member only — referrals are not affected</p>
    </div>

    <div style={{background:"#1a0d0d",border:"1px solid #3a1a1a",borderRadius:12,padding:"12px 18px",marginBottom:22,display:"flex",gap:12,alignItems:"flex-start"}}>
      <span style={{fontSize:18,flexShrink:0}}>⚠️</span>
      <div style={{fontSize:13,color:"#aa7777",lineHeight:1.6}}>
        This action <strong style={{color:"#ff9999"}}>only deducts from the selected member</strong>. Referral uplines are not notified and their points are not touched.
      </div>
    </div>

    <div className="card" style={{padding:"28px 30px",display:"flex",flexDirection:"column",gap:18}}>
      <div>
        <label className="lbl">Select Member</label>
        <select className="inp" value={sel} onChange={e=>{setSel(e.target.value);setConfirm(false);}}>
          <option value="">— Choose member —</option>
          {members.map(m=>{const t=getTier(m.points,tiers);return <option key={m.id} value={m.id}>{m.name} · {t.name} · {m.points.toLocaleString()} pts</option>;})}
        </select>
      </div>

      {member&&<div style={{background:"#0a1020",borderRadius:10,padding:"12px 16px",border:"1px solid #1a2535",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontWeight:700,color:"#ccd",fontSize:15}}>{member.name}</div>
          <div style={{color:"#6677aa",fontSize:12,marginTop:2}}>{member.phone}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <TierBadge tier={tier}/>
          <div style={{fontSize:13,color:"#f59e0b",fontWeight:700,marginTop:4}}>{member.points.toLocaleString()} pts</div>
        </div>
      </div>}

      <div>
        <label className="lbl">Points to Deduct</label>
        <input className="inp" type="number" min="1" max={member?.points||0} placeholder="e.g. 200"
          value={raw} onChange={e=>{setRaw(e.target.value);setConfirm(false);}}/>
        {member&&raw&&parseInt(raw)>member.points&&<div style={{color:"#f87171",fontSize:12,marginTop:5}}>Cannot exceed available balance of {member.points.toLocaleString()} pts</div>}
      </div>

      <div>
        <label className="lbl">Reason <span style={{color:"#2a3a55",fontWeight:400,textTransform:"none",letterSpacing:0}}>(optional)</span></label>
        <input className="inp" placeholder="e.g. Correction, Manual adjustment" value={note} onChange={e=>setNote(e.target.value)}/>
      </div>

      {/* Preview */}
      {member&&pts>0&&parseInt(raw)<=member.points&&<div style={{background:"#1a0d0d",border:"1px solid #3a1a1a",borderRadius:12,padding:"16px 18px"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#f87171",letterSpacing:.8,marginBottom:12,textTransform:"uppercase"}}>Preview</div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <span style={{color:"#aa7777",fontSize:13}}>Current Balance</span>
          <span style={{color:"#ccd",fontWeight:600}}>{member.points.toLocaleString()} pts</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <span style={{color:"#aa7777",fontSize:13}}>Deduction</span>
          <span style={{color:"#f87171",fontWeight:700}}>−{pts.toLocaleString()} pts</span>
        </div>
        <div style={{borderTop:"1px solid #3a1a1a",paddingTop:10,display:"flex",justifyContent:"space-between"}}>
          <span style={{color:"#aa7777",fontSize:13}}>Remaining Balance</span>
          <span style={{color:remaining>0?"#4ade80":"#f59e0b",fontWeight:800,fontSize:16}}>{remaining.toLocaleString()} pts</span>
        </div>
        <div style={{marginTop:10,fontSize:11,color:"#5a3a3a",padding:"8px 10px",background:"#0d0505",borderRadius:8}}>
          Referral uplines: <strong style={{color:"#7a4a4a"}}>not affected</strong>
        </div>
      </div>}

      {/* Confirm toggle */}
      {member&&pts>0&&parseInt(raw)<=member.points&&!confirm&&
        <button className="btn-d" onClick={()=>setConfirm(true)}>◇ Deduct {pts.toLocaleString()} pts from {member.name}</button>}

      {confirm&&<div style={{background:"#1a0505",border:"1px solid #5a1a1a",borderRadius:12,padding:"18px 20px"}}>
        <div style={{color:"#ff9999",fontWeight:700,fontSize:14,marginBottom:8}}>⚠ Confirm Deduction</div>
        <div style={{color:"#aa7777",fontSize:13,marginBottom:16,lineHeight:1.6}}>
          You are about to deduct <strong style={{color:"#f87171"}}>{pts.toLocaleString()} pts</strong> from <strong style={{color:"#f87171"}}>{member.name}</strong>. This cannot be undone.
        </div>
        <div style={{display:"flex",gap:10}}>
          <button className="btn-d" onClick={doDeduct} style={{flex:1,fontWeight:800}}>✓ Confirm Deduct</button>
          <button className="btn-g" onClick={()=>setConfirm(false)} style={{flex:1}}>Cancel</button>
        </div>
      </div>}
    </div>
  </div>;
}

function Config({ctx}){
  const {tiers,setTiers,refLevels,setRefLevels,showToast}=ctx;
  const [tab,setTab]=useState("tiers");
  const [pwForm,setPwForm]=useState({current:"",next:"",confirm:""});
  const [pwErr,setPwErr]=useState("");
  const [pwShow,setPwShow]=useState({current:false,next:false,confirm:false});
  const [pwSaving,setPwSaving]=useState(false);
  const upT=(id,f,v)=>setTiers(p=>p.map(t=>t.id===id?{...t,[f]:f==="minPoints"||f==="multiplier"?Number(v):v}:t));
  const upR=(lv,f,v)=>setRefLevels(p=>p.map(r=>r.level===lv?{...r,[f]:f==="overridePercent"?Number(v):v}:r));

  const changePw=async()=>{
    const {adminPw:storedPw,setAdminPw}=ctx;
    const current=storedPw || import.meta.env.VITE_ADMIN_PASSWORD || "admin1234";
    if(pwForm.current!==current){setPwErr("Current password is incorrect.");return;}
    if(pwForm.next.length<4){setPwErr("New password must be at least 4 characters.");return;}
    if(pwForm.next!==pwForm.confirm){setPwErr("Passwords do not match.");return;}
    setPwSaving(true);
    try{
      await window.storage.set(KEYS.adminPw, pwForm.next, true);
      setAdminPw(pwForm.next);
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
      {["tiers","referral","password"].map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,background:tab===t?"linear-gradient(135deg,#f59e0b,#f97316)":"#0e1420",color:tab===t?"#000":"#5566aa",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{t==="tiers"?"🥇 Tiers":t==="referral"?"◈ Referral Overrides":"🔑 Admin Password"}</button>)}
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
        <button className="btn" onClick={()=>showToast("Tiers saved & synced to member portal!")}>Save Tiers</button>
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
    {tab==="password"&&<div className="si card" style={{padding:"28px 30px",maxWidth:460,display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <div style={{fontWeight:700,color:"#e8eaf0",fontSize:16,marginBottom:4}}>Change Admin Password</div>
        <div style={{fontSize:13,color:"#445566"}}>Password is stored in your browser. Default is <span style={{color:"#f59e0b",fontWeight:600}}>admin1234</span>.</div>
      </div>
      {[
        {key:"current", label:"Current Password"},
        {key:"next",    label:"New Password"},
        {key:"confirm", label:"Confirm New Password"},
      ].map(({key,label})=>(
        <div key={key}>
          <label className="lbl">{label}</label>
          <div style={{position:"relative"}}>
            <input type={pwShow[key]?"text":"password"} className="inp" placeholder="••••••••" value={pwForm[key]}
              onChange={e=>{setPwForm(f=>({...f,[key]:e.target.value}));setPwErr("");}}
              onKeyDown={e=>e.key==="Enter"&&changePw()}
              style={{paddingRight:44}}/>
            <button onClick={()=>setPwShow(s=>({...s,[key]:!s[key]}))} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#445566",cursor:"pointer",fontSize:16,padding:2}}>{pwShow[key]?"🙈":"👁"}</button>
          </div>
        </div>
      ))}
      {pwErr&&<div style={{color:"#f87171",fontSize:13,background:"#2a0d0d",border:"1px solid #5a1a1a",borderRadius:8,padding:"10px 14px"}}>{pwErr}</div>}
      <button className="btn" onClick={changePw} style={{alignSelf:"flex-start",padding:"11px 28px",opacity:pwSaving?0.6:1}} disabled={pwSaving}>{pwSaving?"Saving…":"🔑 Change Password"}</button>
    </div>}
  </div>;
}

// ─── WHATSAPP BLAST ───────────────────────────────────────────────────────────
const DEFAULT_WA_TEMPLATES = [
  { id:"promo",   label:"Promotion",       icon:"🎉", text:"Hi {name}! 🎉 We have an exclusive promotion just for you. Visit us today and enjoy special rewards on your next purchase. Your current balance is {points} pts ({tier} tier). Don't miss out!\n\n— LOYALCORE Team" },
  { id:"points",  label:"Points Update",   icon:"✦",  text:"Hi {name}! Your LOYALCORE points balance has been updated.\n\n✦ Current Balance: {points} pts\n✦ Tier: {tier}\n✦ Multiplier: {multiplier}x\n\nKeep earning and unlock more rewards!\n\n— LOYALCORE Team" },
  { id:"redeem",  label:"Redeem Reminder", icon:"🎁", text:"Hi {name}! 🎁 Reminder: You have {points} pts ready to redeem on exciting rewards. Log in to your LOYALCORE portal to see what's available for you.\n\n— LOYALCORE Team" },
  { id:"tier",    label:"Tier Achievement", icon:"🏆", text:"Hi {name}! Congratulations! 🏆 You've reached {tier} tier status with {points} pts. Enjoy your {multiplier}x points multiplier on every purchase going forward!\n\n— LOYALCORE Team" },
];

function WhatsAppBlast({ctx}){
  const {members,tiers,waTemplates,setWaTemplates,showToast}=ctx;
  const templates=(waTemplates||DEFAULT_WA_TEMPLATES);
  const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const currentMonth=new Date().getMonth(); // 0-indexed

  const [tab,setTab]=useState("blast"); // blast | manage
  const [step,setStep]=useState("compose");
  const [templateId,setTemplateId]=useState(templates[0]?.id||"");
  const [customText,setCustomText]=useState("");
  const [useCustom,setUseCustom]=useState(false);
  const [recipients,setRecipients]=useState("all"); // all | tier | birthday | select
  const [selTier,setSelTier]=useState("");
  const [selBdayMonth,setSelBdayMonth]=useState(String(currentMonth));
  const [selIds,setSelIds]=useState([]);
  const [sentIdx,setSentIdx]=useState(-1);
  const [sendLog,setSendLog]=useState([]);

  // Template editor state
  const [editing,setEditing]=useState(null);
  const [editErr,setEditErr]=useState("");
  const [saving,setSaving]=useState(false);

  const saveTemplates=async(next)=>{
    setSaving(true);
    try{
      await window.storage.set(KEYS.waTemplates,JSON.stringify(next),true);
      setWaTemplates(next);
      showToast("Templates saved!");
    }catch(e){showToast("Failed to save","error");}
    setSaving(false);
  };

  const startEdit=(t)=>setEditing({...t});
  const startNew=()=>setEditing({id:genId(),label:"",icon:"📢",text:"",isNew:true});
  const saveEdit=async()=>{
    if(!editing.label.trim()){setEditErr("Name is required.");return;}
    if(!editing.text.trim()){setEditErr("Message text is required.");return;}
    setEditErr("");
    const next=editing.isNew
      ?[...templates,{id:editing.id,label:editing.label,icon:editing.icon,text:editing.text}]
      :templates.map(t=>t.id===editing.id?{id:t.id,label:editing.label,icon:editing.icon,text:editing.text}:t);
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
    return new Date(m.birthday+"T00:00:00").getMonth()===parseInt(monthIdx);
  });

  const getRecipients=()=>{
    if(recipients==="all") return members;
    if(recipients==="tier") return members.filter(m=>getTier(m.points,tiers).id===selTier);
    if(recipients==="birthday") return getBirthdayList(selBdayMonth);
    return members.filter(m=>selIds.includes(m.id));
  };

  const buildMsg=(member,rawText)=>{
    const tier=getTier(member.points,tiers);
    const bdayMonth=member.birthday?MONTHS[new Date(member.birthday+"T00:00:00").getMonth()]:"";
    return (rawText||"")
      .replace(/{name}/g,     member.name.split(" ")[0])
      .replace(/{fullname}/g, member.name)
      .replace(/{points}/g,   member.points.toLocaleString())
      .replace(/{tier}/g,     tier.name)
      .replace(/{multiplier}/g, tier.multiplier)
      .replace(/{birthday}/g, bdayMonth);
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

  // ── DONE ──
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

  // ── SENDING ──
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

  // ── MAIN ──
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

      {/* ── MANAGE TEMPLATES ── */}
      {tab==="manage"&&<div>
        {editing&&<div className="card si" style={{padding:"24px 26px",marginBottom:20}}>
          <div style={{fontWeight:700,color:"#e8eaf0",fontSize:15,marginBottom:18}}>{editing.isNew?"New Template":"Edit Template"}</div>
          <div style={{display:"grid",gridTemplateColumns:"60px 1fr",gap:14,marginBottom:14}}>
            <div>
              <label className="lbl">Icon</label>
              <input className="inp" value={editing.icon} maxLength={2} onChange={e=>setEditing(v=>({...v,icon:e.target.value}))} style={{textAlign:"center",fontSize:20,padding:"10px 4px"}}/>
            </div>
            <div>
              <label className="lbl">Template Name</label>
              <input className="inp" placeholder="e.g. Birthday Greeting" value={editing.label} onChange={e=>setEditing(v=>({...v,label:e.target.value}))}/>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <label className="lbl">Message Text</label>
            <textarea value={editing.text} onChange={e=>setEditing(v=>({...v,text:e.target.value}))}
              placeholder={"Hi {name}! Wishing you a wonderful birthday this {birthday}! Enjoy {points} pts."}
              style={{width:"100%",minHeight:140,background:"#0a0f1a",border:"1px solid #1e2535",borderRadius:10,
                color:"#e8eaf0",padding:"12px 14px",fontSize:13,fontFamily:"'DM Sans',sans-serif",
                resize:"vertical",outline:"none",lineHeight:1.7,marginTop:4}}/>
            <div style={{marginTop:6,fontSize:11,color:"#2a3a55"}}>
              Placeholders: <span style={{color:"#445577"}}>{"{name}"}</span> · <span style={{color:"#445577"}}>{"{fullname}"}</span> · <span style={{color:"#445577"}}>{"{points}"}</span> · <span style={{color:"#445577"}}>{"{tier}"}</span> · <span style={{color:"#445577"}}>{"{multiplier}"}</span> · <span style={{color:"#f59e0b"}}>{"{birthday}"}</span> (birth month)
            </div>
          </div>
          {editing.text&&<div style={{background:"#0a1a10",border:"1px solid #1a3a1a",borderRadius:10,padding:"14px",marginBottom:14}}>
            <div style={{fontSize:11,color:"#4a7a4a",fontWeight:700,letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>Preview</div>
            <div style={{fontSize:13,color:"#8899bb",lineHeight:1.7,whiteSpace:"pre-wrap"}}>
              {buildMsg(members[0]||{name:"Ahmad",points:1200,phone:"",birthday:"1990-03-15"},editing.text)}
            </div>
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

      {/* ── BLAST TAB ── */}
      {tab==="blast"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

        {/* LEFT — compose */}
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
                  style={{width:"100%",minHeight:140,background:"#0a0f1a",border:"1px solid #1e2535",borderRadius:10,
                    color:"#e8eaf0",padding:"12px 14px",fontSize:13,fontFamily:"'DM Sans',sans-serif",
                    resize:"vertical",outline:"none",lineHeight:1.6,marginTop:4}}/>
              :<div style={{background:"#0a0f1a",borderRadius:10,padding:"14px",border:"1px solid #1e2535",
                  fontSize:13,color:"#8899bb",lineHeight:1.7,whiteSpace:"pre-wrap",marginTop:4,minHeight:100}}>
                {buildMsg(members[0]||{name:"Ahmad",points:1200,phone:"",birthday:"1990-03-15"},msgText)}
              </div>
            }
            <div style={{marginTop:8,fontSize:11,color:"#2a3a55"}}>
              Placeholders: <span style={{color:"#445566"}}>{"{name}"}</span> · <span style={{color:"#445566"}}>{"{points}"}</span> · <span style={{color:"#445566"}}>{"{tier}"}</span> · <span style={{color:"#f59e0b"}}>{"{birthday}"}</span>
            </div>
          </div>
        </div>

        {/* RIGHT — recipients */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Recipients</label>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
              {[
                {v:"all",     l:`🌐 All Members (${members.length})`},
                {v:"birthday",l:`🎂 By Birthday Month`},
                {v:"tier",    l:`🏅 By Tier`},
                {v:"select",  l:`☑️ Select Individually`},
              ].map(o=>(
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
                        fontFamily:"'DM Sans',sans-serif",transition:"all .15s",cursor:"pointer"}}>
                      {m.slice(0,3)}<br/>
                      <span style={{fontSize:10,opacity:.7}}>{cnt} member{cnt!==1?"s":""}</span>
                      {isThis&&<div style={{fontSize:9,color:"#4ade80",marginTop:2}}>● now</div>}
                    </button>
                  );
                })}
              </div>
              {bdayList.length===0&&<div style={{marginTop:10,fontSize:12,color:"#445566",background:"#0a0f1a",borderRadius:8,padding:"10px 14px"}}>
                No members with birthdays in {MONTHS[parseInt(selBdayMonth)]}. Add birthdays in member profiles.
              </div>}
              {bdayList.length>0&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6,maxHeight:160,overflowY:"auto"}}>
                {bdayList.map(m=>{const t=getTier(m.points,tiers);return(
                  <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#0d1a2a",borderRadius:8,border:"1px solid #1a3050"}}>
                    <span style={{fontSize:16}}>🎂</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:"#ccd"}}>{m.name}</div>
                      <div style={{fontSize:11,color:"#445566"}}>{m.birthday?new Date(m.birthday+"T00:00:00").toLocaleDateString("en-MY",{day:"2-digit",month:"short"}):""}</div>
                    </div>
                    <span style={{fontSize:10,color:t.color,background:`${t.color}18`,padding:"2px 8px",borderRadius:99,fontWeight:700}}>{t.name}</span>
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
                <label key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                  background:selIds.includes(m.id)?"#0d1a2a":"#0a0f1a",borderRadius:10,
                  border:`1px solid ${selIds.includes(m.id)?"#1a3050":"#1e2535"}`,cursor:"pointer"}}>
                  <input type="checkbox" checked={selIds.includes(m.id)} onChange={()=>toggleId(m.id)} style={{accentColor:"#f59e0b",width:16,height:16}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#ccd"}}>{m.name}</div>
                    <div style={{fontSize:11,color:"#445566"}}>{m.phone}{m.birthday?" · 🎂 "+new Date(m.birthday+"T00:00:00").toLocaleDateString("en-MY",{day:"2-digit",month:"short"}):""}</div>
                  </div>
                  <span style={{fontSize:10,color:t.color,fontWeight:700,background:`${t.color}18`,padding:"2px 8px",borderRadius:99}}>{t.name}</span>
                </label>
              );})}
            </div>}
          </div>

          {/* Summary + send */}
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
              📱 WhatsApp opens for each recipient with message pre-filled. Confirm each send manually.
            </div>
            <button className="btn" onClick={sendAll}
              disabled={list.length===0||!msgText.trim()}
              style={{width:"100%",background:"linear-gradient(135deg,#25d366,#128c7e)",opacity:list.length===0||!msgText.trim()?0.4:1}}>
              💬 Send to {list.length} Member{list.length!==1?"s":""}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}){
  const {members,tiers,waTemplates,setWaTemplates,showToast}=ctx;
  const templates=(waTemplates||DEFAULT_WA_TEMPLATES);
  const [tab,setTab]=useState("blast"); // blast | manage
  const [step,setStep]=useState("compose");
  const [templateId,setTemplateId]=useState(templates[0]?.id||"");
  const [customText,setCustomText]=useState("");
  const [useCustom,setUseCustom]=useState(false);
  const [recipients,setRecipients]=useState("all");
  const [selTier,setSelTier]=useState("");
  const [selIds,setSelIds]=useState([]);
  const [sentIdx,setSentIdx]=useState(-1);
  const [sendLog,setSendLog]=useState([]);

  // Template editor state
  const [editing,setEditing]=useState(null); // {id,label,icon,text} or null
  const [editErr,setEditErr]=useState("");
  const [saving,setSaving]=useState(false);

  const saveTemplates=async(next)=>{
    setSaving(true);
    try{
      await window.storage.set(KEYS.waTemplates,JSON.stringify(next),true);
      setWaTemplates(next);
      showToast("Templates saved!");
    }catch(e){showToast("Failed to save templates","error");}
    setSaving(false);
  };

  const startEdit=(t)=>setEditing({...t});
  const startNew=()=>setEditing({id:genId(),label:"",icon:"📢",text:"",isNew:true});

  const saveEdit=async()=>{
    if(!editing.label.trim()){setEditErr("Name is required.");return;}
    if(!editing.text.trim()){setEditErr("Message text is required.");return;}
    setEditErr("");
    const next=editing.isNew
      ?[...templates,{id:editing.id,label:editing.label,icon:editing.icon,text:editing.text}]
      :templates.map(t=>t.id===editing.id?{id:t.id,label:editing.label,icon:editing.icon,text:editing.text}:t);
    await saveTemplates(next);
    setEditing(null);
  };

  const deleteTemplate=async(id)=>{
    if(templates.length<=1){showToast("Must keep at least one template","error");return;}
    const next=templates.filter(t=>t.id!==id);
    await saveTemplates(next);
    if(templateId===id) setTemplateId(next[0]?.id||"");
  };

  const template=templates.find(t=>t.id===templateId)||templates[0];

  const getRecipients=()=>{
    if(recipients==="all") return members;
    if(recipients==="tier") return members.filter(m=>getTier(m.points,tiers).id===selTier);
    return members.filter(m=>selIds.includes(m.id));
  };

  const buildMsg=(member,rawText)=>{
    const tier=getTier(member.points,tiers);
    return (rawText||"")
      .replace(/{name}/g,   member.name.split(" ")[0])
      .replace(/{points}/g, member.points.toLocaleString())
      .replace(/{tier}/g,   tier.name)
      .replace(/{multiplier}/g, tier.multiplier);
  };

  const waLink=(phone,msg)=>{
    const num=phone.replace(/\D/g,"");
    const intl=num.startsWith("0")?"60"+num.slice(1):num;
    return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
  };

  const msgText=useCustom?customText:template?.text||"";
  const list=getRecipients();

  const sendAll=()=>{setSentIdx(0);setSendLog([]);setStep("sending");};
  const reset=()=>{setSentIdx(-1);setSendLog([]);setStep("compose");};
  const toggleId=(id)=>setSelIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  useEffect(()=>{
    if(step!=="sending"||sentIdx<0||sentIdx>=list.length) return;
    const member=list[sentIdx];
    const msg=buildMsg(member,msgText);
    window.open(waLink(member.phone,msg),"_blank");
    setSendLog(l=>[...l,{name:member.name,phone:member.phone}]);
    const timer=setTimeout(()=>{
      if(sentIdx+1<list.length) setSentIdx(i=>i+1);
      else setStep("done");
    },1500);
    return()=>clearTimeout(timer);
  },[sentIdx,step]);

  // ── DONE SCREEN ──
  if(step==="done") return(
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

  // ── SENDING SCREEN ──
  if(step==="sending") return(
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

  // ── MAIN UI ──
  return(
    <div className="fi" style={{maxWidth:700}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>WhatsApp Blast</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Send personalised messages to members via WhatsApp</p>
      </div>

      {/* Tab switcher */}
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

      {/* ── MANAGE TEMPLATES TAB ── */}
      {tab==="manage"&&<div>
        {/* Editor */}
        {editing&&<div className="card si" style={{padding:"24px 26px",marginBottom:20}}>
          <div style={{fontWeight:700,color:"#e8eaf0",fontSize:15,marginBottom:18}}>
            {editing.isNew?"New Template":"Edit Template"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"60px 1fr",gap:14,marginBottom:14}}>
            <div>
              <label className="lbl">Icon</label>
              <input className="inp" value={editing.icon} maxLength={2}
                onChange={e=>setEditing(v=>({...v,icon:e.target.value}))}
                style={{textAlign:"center",fontSize:20,padding:"10px 4px"}}/>
            </div>
            <div>
              <label className="lbl">Template Name</label>
              <input className="inp" placeholder="e.g. Monthly Promotion" value={editing.label}
                onChange={e=>setEditing(v=>({...v,label:e.target.value}))}/>
            </div>
          </div>
          <div style={{marginBottom:14}}>
            <label className="lbl">Message Text</label>
            <textarea value={editing.text} onChange={e=>setEditing(v=>({...v,text:e.target.value}))}
              placeholder={"Hi {name}! Your balance is {points} pts ({tier} tier, {multiplier}x multiplier)."}
              style={{width:"100%",minHeight:140,background:"#0a0f1a",border:"1px solid #1e2535",borderRadius:10,
                color:"#e8eaf0",padding:"12px 14px",fontSize:13,fontFamily:"'DM Sans',sans-serif",
                resize:"vertical",outline:"none",lineHeight:1.7,marginTop:4}}/>
            <div style={{marginTop:6,fontSize:11,color:"#2a3a55"}}>
              Placeholders: <span style={{color:"#445577"}}>{"{name}"}</span> · <span style={{color:"#445577"}}>{"{points}"}</span> · <span style={{color:"#445577"}}>{"{tier}"}</span> · <span style={{color:"#445577"}}>{"{multiplier}"}</span>
            </div>
          </div>
          {/* Live preview */}
          {editing.text&&<div style={{background:"#0a1a10",border:"1px solid #1a3a1a",borderRadius:10,padding:"14px",marginBottom:14}}>
            <div style={{fontSize:11,color:"#4a7a4a",fontWeight:700,letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>Preview (first member)</div>
            <div style={{fontSize:13,color:"#8899bb",lineHeight:1.7,whiteSpace:"pre-wrap"}}>
              {buildMsg(members[0]||{name:"Ahmad",points:1200,phone:""},editing.text)}
            </div>
          </div>}
          {editErr&&<div style={{color:"#f87171",fontSize:13,marginBottom:12,background:"#2a0d0d",borderRadius:8,padding:"8px 12px"}}>{editErr}</div>}
          <div style={{display:"flex",gap:10}}>
            <button className="btn" onClick={saveEdit} style={{opacity:saving?0.6:1}} disabled={saving}>
              {saving?"Saving…":"💾 Save Template"}
            </button>
            <button className="btn-g" onClick={()=>{setEditing(null);setEditErr("");}}>Cancel</button>
          </div>
        </div>}

        {/* Template list */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {templates.map((t,i)=>(
            <div key={t.id} className="card" style={{padding:"18px 20px",display:"flex",gap:14,alignItems:"flex-start"}}>
              <div style={{fontSize:28,flexShrink:0,marginTop:2}}>{t.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,color:"#e8eaf0",fontSize:14,marginBottom:4}}>{t.label}</div>
                <div style={{fontSize:12,color:"#445566",lineHeight:1.6,whiteSpace:"pre-wrap",overflow:"hidden",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical"}}>
                  {t.text}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8,flexShrink:0}}>
                <button className="btn-g" onClick={()=>startEdit(t)} style={{fontSize:12,padding:"7px 14px"}}>✏️ Edit</button>
                {templates.length>1&&<button className="btn-d" onClick={()=>deleteTemplate(t.id)} style={{fontSize:12,padding:"7px 14px"}}>✕ Delete</button>}
              </div>
            </div>
          ))}
          <button className="btn-g" onClick={startNew} style={{alignSelf:"flex-start",padding:"10px 20px"}}>
            ⊕ Add New Template
          </button>
        </div>
      </div>}

      {/* ── BLAST TAB ── */}
      {tab==="blast"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

        {/* LEFT */}
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
                  background:useCustom?"#1a1a0d":"#0a0f1a",
                  border:`1px solid ${useCustom?"#4a4a1a":"#1e2535"}`,
                  color:useCustom?"#f5c842":"#6677aa",
                  fontFamily:"'DM Sans',sans-serif",transition:"all .15s"}}>
                ✏️ One-time Custom Message
              </button>
            </div>
          </div>

          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">{useCustom?"Your Message":"Message Preview"}</label>
            {useCustom
              ?<textarea value={customText} onChange={e=>setCustomText(e.target.value)}
                  placeholder={"Hi {name}! Use {points}, {tier}, {multiplier} as placeholders."}
                  style={{width:"100%",minHeight:160,background:"#0a0f1a",border:"1px solid #1e2535",borderRadius:10,
                    color:"#e8eaf0",padding:"12px 14px",fontSize:13,fontFamily:"'DM Sans',sans-serif",
                    resize:"vertical",outline:"none",lineHeight:1.6,marginTop:4}}/>
              :<div style={{background:"#0a0f1a",borderRadius:10,padding:"14px",border:"1px solid #1e2535",
                  fontSize:13,color:"#8899bb",lineHeight:1.7,whiteSpace:"pre-wrap",marginTop:4,minHeight:120}}>
                {buildMsg(members[0]||{name:"Ahmad",points:1200,phone:""},msgText)}
              </div>
            }
            <div style={{marginTop:8,fontSize:11,color:"#2a3a55"}}>
              Placeholders: <span style={{color:"#445566"}}>{"{name}"}</span> · <span style={{color:"#445566"}}>{"{points}"}</span> · <span style={{color:"#445566"}}>{"{tier}"}</span> · <span style={{color:"#445566"}}>{"{multiplier}"}</span>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Recipients</label>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
              {[{v:"all",l:`All Members (${members.length})`},{v:"tier",l:"By Tier"},{v:"select",l:"Select Individually"}].map(o=>(
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
            {recipients==="tier"&&<div style={{marginTop:12}}>
              <label className="lbl">Select Tier</label>
              <select className="inp" value={selTier} onChange={e=>setSelTier(e.target.value)}>
                <option value="">— Choose tier —</option>
                {tiers.map(t=>{const cnt=members.filter(m=>getTier(m.points,tiers).id===t.id).length;return<option key={t.id} value={t.id}>{t.icon} {t.name} ({cnt})</option>;})}
              </select>
            </div>}
            {recipients==="select"&&<div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
              {members.map(m=>{const t=getTier(m.points,tiers);return(
                <label key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                  background:selIds.includes(m.id)?"#0d1a2a":"#0a0f1a",borderRadius:10,
                  border:`1px solid ${selIds.includes(m.id)?"#1a3050":"#1e2535"}`,cursor:"pointer"}}>
                  <input type="checkbox" checked={selIds.includes(m.id)} onChange={()=>toggleId(m.id)} style={{accentColor:"#f59e0b",width:16,height:16}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#ccd"}}>{m.name}</div>
                    <div style={{fontSize:11,color:"#445566"}}>{m.phone}</div>
                  </div>
                  <span style={{fontSize:10,color:t.color,fontWeight:700,background:`${t.color}18`,padding:"2px 8px",borderRadius:99}}>{t.name}</span>
                </label>
              );})}
            </div>}
          </div>

          <div className="card" style={{padding:"22px 24px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <span style={{color:"#5566aa",fontSize:13}}>Recipients</span>
              <span style={{color:"#f59e0b",fontWeight:700,fontSize:15}}>{list.length} members</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:18}}>
              <span style={{color:"#5566aa",fontSize:13}}>Template</span>
              <span style={{color:"#ccd",fontSize:13,fontWeight:500}}>{useCustom?"✏️ Custom":template?.icon+" "+template?.label}</span>
            </div>
            <div style={{background:"#0a1a0d",border:"1px solid #1a3a1a",borderRadius:10,padding:"11px 14px",marginBottom:14,fontSize:12,color:"#4a7a4a",lineHeight:1.6}}>
              📱 WhatsApp opens for each recipient with message pre-filled. You confirm each send manually.
            </div>
            <button className="btn" onClick={sendAll}
              disabled={list.length===0||!msgText.trim()}
              style={{width:"100%",background:"linear-gradient(135deg,#25d366,#128c7e)",opacity:list.length===0||!msgText.trim()?0.4:1}}>
              💬 Send to {list.length} Member{list.length!==1?"s":""}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}){
  const {members,tiers}=ctx;
  const [step,setStep]=useState("compose"); // compose | preview | sending
  const [templateId,setTemplateId]=useState("promo");
  const [customText,setCustomText]=useState("");
  const [recipients,setRecipients]=useState("all"); // all | tier | select
  const [selTier,setSelTier]=useState("");
  const [selIds,setSelIds]=useState([]);
  const [sentIdx,setSentIdx]=useState(-1);
  const [sendLog,setSendLog]=useState([]);

  const template=WA_TEMPLATES.find(t=>t.id===templateId);

  const getRecipients=()=>{
    if(recipients==="all") return members;
    if(recipients==="tier") return members.filter(m=>getTier(m.points,tiers).id===selTier);
    return members.filter(m=>selIds.includes(m.id));
  };

  const buildMsg=(member,rawText)=>{
    const tier=getTier(member.points,tiers);
    return (rawText||"")
      .replace(/{name}/g,   member.name.split(" ")[0])
      .replace(/{points}/g, member.points.toLocaleString())
      .replace(/{tier}/g,   tier.name)
      .replace(/{multiplier}/g, tier.multiplier);
  };

  const waLink=(phone,msg)=>{
    const num=phone.replace(/\D/g,"");
    const intl=num.startsWith("0")?"60"+num.slice(1):num;
    return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
  };

  const msgText=templateId==="custom"?customText:template?.text||"";
  const list=getRecipients();

  const sendAll=()=>{
    setSentIdx(0);
    setSendLog([]);
    setStep("sending");
  };

  // Open each WhatsApp link one by one
  useEffect(()=>{
    if(step!=="sending"||sentIdx<0||sentIdx>=list.length) return;
    const member=list[sentIdx];
    const msg=buildMsg(member,msgText);
    const link=waLink(member.phone,msg);
    window.open(link,"_blank");
    setSendLog(l=>[...l,{name:member.name,phone:member.phone,sent:true}]);
    const timer=setTimeout(()=>{
      if(sentIdx+1<list.length) setSentIdx(i=>i+1);
      else setStep("done");
    },1500);
    return()=>clearTimeout(timer);
  },[sentIdx,step]);

  const reset=()=>{setSentIdx(-1);setSendLog([]);setStep("compose");};

  const toggleId=(id)=>setSelIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  if(step==="done") return(
    <div className="fi" style={{maxWidth:560}}>
      <div style={{marginBottom:28}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>WhatsApp Blast</h1>
      </div>
      <div className="card" style={{padding:"32px",textAlign:"center"}}>
        <div style={{fontSize:56,marginBottom:16}}>✅</div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:"#e8eaf0",marginBottom:8}}>Blast Complete</div>
        <div style={{color:"#5566aa",fontSize:14,marginBottom:28}}>{sendLog.length} messages sent via WhatsApp</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:280,overflowY:"auto",marginBottom:24,textAlign:"left"}}>
          {sendLog.map((l,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",background:"#0d2a1a",borderRadius:10,border:"1px solid #1a4a2a"}}>
              <span style={{color:"#ccd",fontSize:13,fontWeight:500}}>{l.name}</span>
              <span style={{color:"#4ade80",fontSize:12}}>✓ Sent · {l.phone}</span>
            </div>
          ))}
        </div>
        <button className="btn" onClick={reset}>Send Another Blast</button>
      </div>
    </div>
  );

  if(step==="sending") return(
    <div className="fi" style={{maxWidth:560}}>
      <div style={{marginBottom:28}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>WhatsApp Blast</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Opening WhatsApp for each recipient…</p>
      </div>
      <div className="card" style={{padding:"32px",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16,animation:"spin 1.5s linear infinite",display:"inline-block"}}>💬</div>
        <div style={{color:"#e8eaf0",fontSize:16,fontWeight:600,marginBottom:4}}>Sending {sentIdx+1} of {list.length}</div>
        <div style={{color:"#5566aa",fontSize:13,marginBottom:24}}>{list[sentIdx]?.name} · {list[sentIdx]?.phone}</div>
        <div style={{background:"#0a0f1a",borderRadius:10,height:6,overflow:"hidden",marginBottom:24}}>
          <div style={{height:"100%",background:"linear-gradient(90deg,#25d366,#128c7e)",borderRadius:10,width:`${((sentIdx+1)/list.length)*100}%`,transition:"width .4s ease"}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:200,overflowY:"auto",textAlign:"left",marginBottom:16}}>
          {sendLog.map((l,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",background:"#0d2a1a",borderRadius:8,border:"1px solid #1a4a2a"}}>
              <span style={{color:"#ccd",fontSize:12}}>{l.name}</span>
              <span style={{color:"#4ade80",fontSize:11}}>✓ Opened</span>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,color:"#2a3a4a"}}>WhatsApp opens automatically for each contact. Allow pop-ups if prompted.</div>
      </div>
    </div>
  );

  return(
    <div className="fi" style={{maxWidth:640}}>
      <div style={{marginBottom:28}}>
        <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#e8eaf0"}}>WhatsApp Blast</h1>
        <p style={{color:"#5566aa",fontSize:14,marginTop:4}}>Send personalised promotional messages to members via WhatsApp</p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>

        {/* LEFT — Compose */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* Template picker */}
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Message Template</label>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
              {WA_TEMPLATES.map(t=>(
                <button key={t.id} onClick={()=>setTemplateId(t.id)}
                  style={{padding:"11px 14px",borderRadius:10,fontSize:13,fontWeight:600,textAlign:"left",
                    background:templateId===t.id?"#0d2a1a":"#0a0f1a",
                    border:`1px solid ${templateId===t.id?"#1a5a2a":"#1e2535"}`,
                    color:templateId===t.id?"#4ade80":"#6677aa",
                    fontFamily:"'DM Sans',sans-serif",transition:"all .15s"}}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom text or preview */}
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">{templateId==="custom"?"Your Message":"Message Preview"}</label>
            {templateId==="custom"
              ? <textarea value={customText} onChange={e=>setCustomText(e.target.value)}
                  placeholder={"Hi {name}! Use {points}, {tier}, {multiplier} as placeholders."}
                  style={{width:"100%",minHeight:160,background:"#0a0f1a",border:"1px solid #1e2535",borderRadius:10,color:"#e8eaf0",padding:"12px 14px",fontSize:13,fontFamily:"'DM Sans',sans-serif",resize:"vertical",outline:"none",lineHeight:1.6,marginTop:4}}/>
              : <div style={{background:"#0a0f1a",borderRadius:10,padding:"14px",border:"1px solid #1e2535",fontSize:13,color:"#8899bb",lineHeight:1.7,whiteSpace:"pre-wrap",marginTop:4,minHeight:120}}>
                  {buildMsg(members[0]||{name:"Ahmad",points:1200,phone:"",referralCode:""},msgText)}
                </div>
            }
            <div style={{marginTop:8,fontSize:11,color:"#2a3a55"}}>
              Placeholders: <span style={{color:"#445566"}}>{"{name}"}</span> · <span style={{color:"#445566"}}>{"{points}"}</span> · <span style={{color:"#445566"}}>{"{tier}"}</span> · <span style={{color:"#445566"}}>{"{multiplier}"}</span>
            </div>
          </div>
        </div>

        {/* RIGHT — Recipients */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{padding:"22px 24px"}}>
            <label className="lbl">Recipients</label>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
              {[{v:"all",l:`All Members (${members.length})`},{v:"tier",l:"By Tier"},{v:"select",l:"Select Individually"}].map(o=>(
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
            {recipients==="tier"&&<div style={{marginTop:12}}>
              <label className="lbl">Select Tier</label>
              <select className="inp" value={selTier} onChange={e=>setSelTier(e.target.value)}>
                <option value="">— Choose tier —</option>
                {tiers.map(t=>{const cnt=members.filter(m=>getTier(m.points,tiers).id===t.id).length;return<option key={t.id} value={t.id}>{t.icon} {t.name} ({cnt})</option>;})}
              </select>
            </div>}
            {recipients==="select"&&<div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
              {members.map(m=>{const t=getTier(m.points,tiers);return(
                <label key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:selIds.includes(m.id)?"#0d1a2a":"#0a0f1a",borderRadius:10,border:`1px solid ${selIds.includes(m.id)?"#1a3050":"#1e2535"}`,cursor:"pointer",transition:"all .15s"}}>
                  <input type="checkbox" checked={selIds.includes(m.id)} onChange={()=>toggleId(m.id)} style={{accentColor:"#f59e0b",width:16,height:16}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#ccd"}}>{m.name}</div>
                    <div style={{fontSize:11,color:"#445566"}}>{m.phone}</div>
                  </div>
                  <span style={{fontSize:10,color:t.color,fontWeight:700,background:`${t.color}18`,padding:"2px 8px",borderRadius:99}}>{t.name}</span>
                </label>
              );})}
            </div>}
          </div>

          {/* Summary + Send */}
          <div className="card" style={{padding:"22px 24px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
              <span style={{color:"#5566aa",fontSize:13}}>Recipients</span>
              <span style={{color:"#f59e0b",fontWeight:700,fontSize:15}}>{list.length} members</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:20}}>
              <span style={{color:"#5566aa",fontSize:13}}>Template</span>
              <span style={{color:"#ccd",fontSize:13,fontWeight:500}}>{template?.icon} {template?.label}</span>
            </div>
            <div style={{background:"#0a1a0d",border:"1px solid #1a3a1a",borderRadius:10,padding:"12px 14px",marginBottom:16,fontSize:12,color:"#4a7a4a",lineHeight:1.6}}>
              📱 WhatsApp will open for each recipient with the message pre-filled. You confirm each send manually.
            </div>
            <button className="btn" onClick={sendAll}
              disabled={list.length===0||!msgText.trim()}
              style={{width:"100%",background:"linear-gradient(135deg,#25d366,#128c7e)",opacity:list.length===0||!msgText.trim()?0.4:1}}>
              💬 Send to {list.length} Member{list.length!==1?"s":""}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
