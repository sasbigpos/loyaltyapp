import { useState, useEffect, useRef, useCallback } from "react";
// subscribeToKey loaded dynamically — works in both Claude sandbox and hosted build
let _subscribeToKey = null;
async function getSubscriber() {
  if (_subscribeToKey) return _subscribeToKey;
  try { const m = await import('./firebase.js'); _subscribeToKey = m.subscribeToKey; }
  catch { _subscribeToKey = null; }
  return _subscribeToKey;
}

// ─── STORAGE KEYS (must match Admin app exactly) ──────────────────────────────
const KEYS = { 
  members:"lc:members", 
  tiers:"lc:tiers", 
  refLevels:"lc:refLevels", 
  rewards:"lc:rewards",
  config:"lc:config"  // ← ADD THIS
};

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
const REWARDS_CATALOG = [
  { id:"r1", name:"Free Dessert",     pts:200,  icon:"🍰", category:"Dining"   },
  { id:"r2", name:"Room Upgrade",     pts:500,  icon:"🏨", category:"Stay"     },
  { id:"r3", name:"Spa 30 min",       pts:800,  icon:"💆", category:"Wellness" },
  { id:"r4", name:"Airport Transfer", pts:1200, icon:"🚗", category:"Travel"   },
  { id:"r5", name:"Chef's Table",     pts:1500, icon:"👨‍🍳", category:"Dining"  },
  { id:"r6", name:"Weekend Getaway",  pts:4000, icon:"🌴", category:"Stay"     },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtPhone = v => v.replace(/\D/g,"").slice(0,11).replace(/(\d{3})(\d{0,4})(\d{0,4})/,(_,a,b,c)=>c?`${a}-${b}-${c}`:b?`${a}-${b}`:a);
const getTier  = (pts,tiers) => [...tiers].reverse().find(t=>pts>=t.minPoints)||tiers[0];
const today    = () => new Date().toLocaleDateString("en-MY",{day:"2-digit",month:"short"});
const genId    = () => Math.random().toString(36).slice(2,9);

function getDownline(members,rootId,maxDepth){
  const tree={};
  members.forEach(m=>{if(m.referredBy)tree[m.referredBy]=[...(tree[m.referredBy]||[]),m.id];});
  const walk=(id,d)=>{if(d>maxDepth)return[];return(tree[id]||[]).flatMap(cid=>[{id:cid,level:d},...walk(cid,d+1)]);};
  return walk(rootId,1);
}

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────
async function loadAll(){
  try{
    const [mr,tr,rr,rwR,cfgR]=await Promise.all([  // ← ADD cfgR
      window.storage.get(KEYS.members,  true).catch(()=>null),
      window.storage.get(KEYS.tiers,    true).catch(()=>null),
      window.storage.get(KEYS.refLevels,true).catch(()=>null),
      window.storage.get(KEYS.rewards,  true).catch(()=>null),
      window.storage.get(KEYS.config,   true).catch(()=>null),  // ← ADD THIS
    ]);
    return {
      members:   mr?JSON.parse(mr.value):null,
      tiers:     tr?JSON.parse(tr.value):DEFAULT_TIERS,
      refLevels: rr?JSON.parse(rr.value):DEFAULT_REF,
      rewards:   rwR?JSON.parse(rwR.value):null,
      config:    cfgR?JSON.parse(cfgR.value):{ welcomeEnabled: true, welcomePts: 100 },  // ← ADD THIS
    };
  }catch{
    return{
      members:null,
      tiers:DEFAULT_TIERS,
      refLevels:DEFAULT_REF,
      rewards:null,
      config:{ welcomeEnabled: true, welcomePts: 100 }  // ← ADD THIS
    };
  }
}
async function saveMembers(members){try{await window.storage.set(KEYS.members,JSON.stringify(members),true);}catch(e){console.error(e);}}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function useCountUp(target,duration=1000){
  const [v,setV]=useState(target);const prev=useRef(target);
  useEffect(()=>{
    const from=prev.current;prev.current=target;let s=null;
    const step=ts=>{if(!s)s=ts;const p=Math.min((ts-s)/duration,1);const e=1-Math.pow(1-p,4);setV(Math.round(from+(target-from)*e));if(p<1)requestAnimationFrame(step);};
    requestAnimationFrame(step);
  },[target]);
  return v;
}
function PBar({value,max,color,h=6}){
  return <div style={{background:"#ffffff14",borderRadius:99,height:h,overflow:"hidden"}}>
    <div style={{width:`${Math.min((value/Math.max(max,1))*100,100)}%`,height:"100%",background:color,borderRadius:99,transition:"width .9s cubic-bezier(.4,0,.2,1)",boxShadow:`0 0 6px ${color}88`}}/>
  </div>;
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function MemberApp(){
  const [members,   setMembersState] = useState([]);
  const [tiers,     setTiers]        = useState(DEFAULT_TIERS);
  const [refLevels, setRefLevels]    = useState(DEFAULT_REF);
  const [rewards,   setRewards]      = useState(REWARDS_CATALOG);
  const [appConfig, setAppConfig]    = useState({ welcomeEnabled: true, welcomePts: 100 });  // ← ADD THIS
  // Read merchant code from URL query param ?mc=CODE (set by QR code)
  const urlMc=(()=>{try{return new URLSearchParams(window.location.search).get("mc")||"";}catch{return "";}})();
  const [screen,    setScreen]       = useState(urlMc?"register":"login"); // login | register | portal
  const [memberId,  setMemberId]     = useState(null);
  const [loading,   setLoading]      = useState(true);
  const [syncing,   setSyncing]      = useState(false);
  const [lastSync,  setLastSync]     = useState(null);
  const [notif,     setNotif]        = useState(null);

  const showNotif = (msg,type="success")=>{setNotif({msg,type});setTimeout(()=>setNotif(null),2800);};

  // Write-through members
  const setMembers = useCallback((fn)=>{
    setSyncing(true);
    setMembersState(prev=>{
      const next=typeof fn==="function"?fn(prev):fn;
      saveMembers(next).finally(()=>{setSyncing(false);setLastSync(new Date());});
      return next;
    });
  },[]);

  // ── Initial load + real-time subscriptions ─────────────────────────────────
  useEffect(()=>{
    let unsubs = [];

    const bootstrap = async () => {
      // 1. One-shot initial load — use defaults if Firestore is empty
      try {
        const [mr,tr,rr,rwR,cfgR]=await Promise.all([  // ← ADD cfgR
          window.storage.get(KEYS.members,  true).catch(()=>null),
          window.storage.get(KEYS.tiers,    true).catch(()=>null),
          window.storage.get(KEYS.refLevels,true).catch(()=>null),
          window.storage.get(KEYS.rewards,  true).catch(()=>null),
          window.storage.get(KEYS.config,   true).catch(()=>null),  // ← ADD THIS
        ]);
        // If Firestore has data, use it; otherwise fall back to defaults
        // (Admin app will seed Firestore on its first run)
        setMembersState(mr ? JSON.parse(mr.value) : []);
        if(tr) setTiers(JSON.parse(tr.value));
        if(rr) setRefLevels(JSON.parse(rr.value));
        if(rwR) setRewards(JSON.parse(rwR.value));
        if(cfgR) setAppConfig(JSON.parse(cfgR.value));  // ← ADD THIS
      } catch {}
      setLoading(false); setLastSync(new Date());

      // 2. Subscribe to real-time updates via Firebase onSnapshot
      //    (no-ops silently in Claude artifact sandbox)
      const sub = await getSubscriber();
      if (sub) {
        unsubs = [
          sub(KEYS.members,   v => { setMembersState(JSON.parse(v)); setLastSync(new Date()); }),
          sub(KEYS.tiers,     v => setTiers(JSON.parse(v))),
          sub(KEYS.refLevels, v => setRefLevels(JSON.parse(v))),
          sub(KEYS.rewards,   v => setRewards(JSON.parse(v))),
          sub(KEYS.config,    v => setAppConfig(JSON.parse(v))),  // ← ADD THIS
        ];
      }
    };

    bootstrap();
    return () => unsubs.forEach(fn => fn && fn());
  },[]);

  const member = members.find(m=>m.id===memberId);

  if(loading) return(
    <div style={{minHeight:"100vh",background:"#f7f2eb",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:700,color:"#10b981",marginBottom:16}}>B LOYALTY</div>
        <div style={{width:32,height:32,border:"3px solid #e0d4c0",borderTop:"3px solid #f5c842",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto"}}/>
        <div style={{color:"#9a8a7a",fontSize:13,marginTop:16,fontFamily:"'DM Sans',sans-serif"}}>Loading your membership…</div>
      </div>
    </div>
  );

  return(
    <div style={{background:"#f7f2eb",minHeight:"100vh",display:"flex",justifyContent:"center"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Cormorant+Garamond:ital,wght@0,300;0,500;0,600;0,700;1,400;1,600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;} ::-webkit-scrollbar{display:none;} button{cursor:pointer;border:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation;} input,select{outline:none;font-size:16px!important;}
        .sans{font-family:'DM Sans',sans-serif;} .serif{font-family:'Cormorant Garamond',serif;}
        @keyframes fadeUp  {from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scaleIn {from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}
        @keyframes notifIn {from{transform:translateY(-50px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes cardShine{0%{left:-80%}100%{left:140%}}
        @keyframes spin    {to{transform:rotate(360deg)}}
        @keyframes pulse   {0%,100%{opacity:1}50%{opacity:.3}}
        .fu{animation:fadeUp .45s ease both}
        .si{animation:scaleIn .35s cubic-bezier(.34,1.56,.64,1) both}
        .card-shine{position:absolute;top:0;left:-80%;width:55%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent);transform:skewX(-15deg);animation:cardShine 3.5s ease infinite;pointer-events:none;}
        .mem-reward{transition:all .2s;}
        .tab-btn{transition:all .2s;min-height:44px;min-width:44px;}
        input[type="password"]{font-size:16px!important;}
      `}</style>

      <div style={{width:"100%",maxWidth:430,minHeight:"100vh",background:"#f7f2eb",position:"relative",display:"flex",flexDirection:"column"}}>
        {/* NOTIFICATION */}
        {notif&&<div className="sans" style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:notif.type==="success"?"#1a3a1a":"#3a1a1a",color:notif.type==="success"?"#86efac":"#fca5a5",padding:"12px 20px",borderRadius:99,fontSize:13,fontWeight:500,zIndex:9999,animation:"notifIn .4s cubic-bezier(.34,1.56,.64,1)",whiteSpace:"nowrap",boxShadow:"0 8px 32px #00000033",maxWidth:"calc(100vw - 32px)",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis"}}>{notif.msg}</div>}

        {screen==="register"
          ? <RegisterScreen
              members={members} tiers={tiers} appConfig={appConfig} merchantCode={urlMc}
              setMembers={setMembersState}
              onSuccess={(id)=>{setMemberId(id);setScreen("portal");}}
              onBack={()=>setScreen("login")}/>
          : screen==="login"
          ? <LoginScreen members={members} tiers={tiers} onLogin={id=>{setMemberId(id);setScreen("portal");}} onRegister={()=>setScreen("register")}/>
          : member
            ? <Portal key={memberId} member={member} members={members} tiers={tiers} refLevels={refLevels} rewards={rewards} setMembers={setMembers} showNotif={showNotif} syncing={syncing} lastSync={lastSync} onLogout={()=>{setMemberId(null);setScreen("login");}}/>
            : <div style={{padding:40,textAlign:"center",fontFamily:"'DM Sans',sans-serif",color:"#9a8a7a"}}>Member not found.<br/><button onClick={()=>setScreen("login")} style={{marginTop:12,background:"#f5c842",color:"#1a1208",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Back to Login</button></div>
        }
      </div>
    </div>
  );
}

// ... (rest of your code remains exactly the same - LoginScreen, Portal, HomeTab, RewardsTab, ReferralTab, HistoryTab, ProfileTab, RegisterScreen)