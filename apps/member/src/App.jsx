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
const KEYS = { members:"lc:members", tiers:"lc:tiers", refLevels:"lc:refLevels", rewards:"lc:rewards" };

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
    const [mr,tr,rr,rwR]=await Promise.all([
      window.storage.get(KEYS.members,  true).catch(()=>null),
      window.storage.get(KEYS.tiers,    true).catch(()=>null),
      window.storage.get(KEYS.refLevels,true).catch(()=>null),
      window.storage.get(KEYS.rewards,  true).catch(()=>null),
    ]);
    return {
      members:   mr?JSON.parse(mr.value):null,
      tiers:     tr?JSON.parse(tr.value):DEFAULT_TIERS,
      refLevels: rr?JSON.parse(rr.value):DEFAULT_REF,
      rewards:   rwR?JSON.parse(rwR.value):null,
    };
  }catch{return{members:null,tiers:DEFAULT_TIERS,refLevels:DEFAULT_REF,rewards:null};}
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
  const [screen,    setScreen]       = useState("login"); // login | portal
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
        const [mr,tr,rr,rwR]=await Promise.all([
          window.storage.get(KEYS.members,  true).catch(()=>null),
          window.storage.get(KEYS.tiers,    true).catch(()=>null),
          window.storage.get(KEYS.refLevels,true).catch(()=>null),
          window.storage.get(KEYS.rewards,  true).catch(()=>null),
        ]);
        // If Firestore has data, use it; otherwise fall back to defaults
        // (Admin app will seed Firestore on its first run)
        setMembersState(mr ? JSON.parse(mr.value) : []);
        if(tr) setTiers(JSON.parse(tr.value));
        if(rr) setRefLevels(JSON.parse(rr.value));
        if(rwR) setRewards(JSON.parse(rwR.value));
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

        {screen==="login"
          ? <LoginScreen members={members} tiers={tiers} onLogin={id=>{setMemberId(id);setScreen("portal");}}/>
          : member
            ? <Portal key={memberId} member={member} members={members} tiers={tiers} refLevels={refLevels} rewards={rewards} setMembers={setMembers} showNotif={showNotif} syncing={syncing} lastSync={lastSync} onLogout={()=>{setMemberId(null);setScreen("login");}}/>
            : <div style={{padding:40,textAlign:"center",fontFamily:"'DM Sans',sans-serif",color:"#9a8a7a"}}>Member not found.<br/><button onClick={()=>setScreen("login")} style={{marginTop:12,background:"#f5c842",color:"#1a1208",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Back to Login</button></div>
        }
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({members,tiers,onLogin}){
  const [step,setStep]=useState("phone"); // "phone" | "pin"
  const [phone,setPhone]=useState("");
  const [pin,setPin]=useState("");
  const [found,setFound]=useState(null);
  const [err,setErr]=useState("");
  const pinInputRef=useRef();

  const submitPhone=()=>{
    const raw=phone.replace(/\D/g,"");
    const m=members.find(m=>m.phone.replace(/\D/g,"")===raw);
    if(!m){setErr("No member found with this number.");return;}
    setFound(m);setPin("");setErr("");setStep("pin");
    setTimeout(()=>pinInputRef.current?.focus(),150);
  };

  const submitPin=(val)=>{
    const p=val||pin;
    const memberPin=found.pin||"0000";
    if(p===memberPin){onLogin(found.id);}
    else{setErr("Incorrect PIN. Please try again.");setPin("");}
  };

  const handlePinChange=(e)=>{
    const val=e.target.value.replace(/\D/g,"").slice(0,4);
    setPin(val);
    setErr("");
    if(val.length===4) setTimeout(()=>submitPin(val),80);
  };

  const Logo=(
    <div className="fu" style={{textAlign:"center",marginBottom:40}}>
      <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:44,fontWeight:700,color:"#10b981",WebkitTextFillColor:"#10b981",letterSpacing:-1,lineHeight:1}}>B LOYALTY</div>
      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#5a4a2a",letterSpacing:3,marginTop:6,textTransform:"uppercase"}}>Member Portal</div>
    </div>
  );

  if(step==="pin"&&found){
    const tier=getTier(found.points,tiers);
    return(
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",background:"linear-gradient(170deg,#1a1208 0%,#0d0a06 50%,#1a1208 100%)",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:"-15%",right:"-20%",width:300,height:300,borderRadius:"50%",background:"radial-gradient(ellipse,#f5c84214,transparent 70%)"}}/>
        <div style={{position:"absolute",bottom:"-15%",left:"-20%",width:280,height:280,borderRadius:"50%",background:"radial-gradient(ellipse,#cd7f3210,transparent 70%)"}}/>
        {Logo}
        <div className="si" style={{width:"100%",background:"#14100a",border:"1px solid #3a2a12",borderRadius:22,padding:"32px 28px"}}>
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:`${tier.color}22`,border:`2px solid ${tier.color}66`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{tier.icon}</div>
            <div>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:"#f7f2eb",fontWeight:600}}>{found.name}</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6a5a3a"}}>{found.phone}</div>
            </div>
          </div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#8a6a3a",marginBottom:20,textAlign:"center"}}>Enter your 4-digit PIN</div>

          {/* PIN display dots — visual only, actual input is hidden below */}
          <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:20}}
               onClick={()=>pinInputRef.current?.focus()}>
            {[0,1,2,3].map(i=>(
              <div key={i} style={{
                width:56,height:64,borderRadius:14,
                background: pin[i] ? "#1a1208" : "#0d0a06",
                border:`2px solid ${pin[i]?"#f5c842":err?"#5a1a1a":"#3a2a12"}`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:28,color:"#f5c842",fontWeight:700,
                transition:"border-color .15s",
                cursor:"text"
              }}>
                {pin[i] ? "●" : ""}
              </div>
            ))}
          </div>

          {/* Single hidden input — captures all keyboard input including mobile */}
          <input
            ref={pinInputRef}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={4}
            value={pin}
            onChange={handlePinChange}
            onKeyDown={e=>e.key==="Enter"&&submitPin()}
            style={{
              position:"absolute",opacity:0,width:1,height:1,
              top:0,left:0,pointerEvents:"none"
            }}
          />

          {err&&<div style={{color:"#f87171",fontSize:13,marginBottom:16,textAlign:"center",fontFamily:"'DM Sans',sans-serif",background:"#2a0d0d",borderRadius:8,padding:"8px 14px"}}>{err}</div>}

          <button onClick={()=>submitPin()} style={{width:"100%",padding:"17px",background:"linear-gradient(135deg,#f5c842,#f59e0b)",borderRadius:14,fontSize:15,fontWeight:700,color:"#1a1208",fontFamily:"'DM Sans',sans-serif",letterSpacing:.3,boxShadow:"0 4px 20px #f5c84244",border:"none",marginBottom:12}}>
            Verify PIN →
          </button>
          <button onClick={()=>pinInputRef.current?.focus()} style={{width:"100%",padding:"14px",background:"#1a1208",border:"1px solid #3a2a12",borderRadius:12,fontSize:13,color:"#8a6a3a",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
            Tap to open keyboard
          </button>
          <button onClick={()=>{setStep("phone");setPin("");setErr("");}} style={{width:"100%",padding:"10px",background:"transparent",border:"1px solid #2a1a08",borderRadius:10,fontSize:13,color:"#4a3a1a",fontFamily:"'DM Sans',sans-serif"}}>
            ← Use different number
          </button>
          <div style={{marginTop:14,fontSize:11,color:"#3a2a12",textAlign:"center",fontFamily:"'DM Sans',sans-serif"}}>Default PIN: <span style={{color:"#f5c842",fontWeight:600}}>1234</span> · Set by admin on enrollment</div>
        </div>
      </div>
    );
  }

  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",background:"linear-gradient(170deg,#1a1208 0%,#0d0a06 50%,#1a1208 100%)",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:"-15%",right:"-20%",width:300,height:300,borderRadius:"50%",background:"radial-gradient(ellipse,#f5c84214,transparent 70%)"}}/>
      <div style={{position:"absolute",bottom:"-15%",left:"-20%",width:280,height:280,borderRadius:"50%",background:"radial-gradient(ellipse,#cd7f3210,transparent 70%)"}}/>
      {Logo}
      <div className="fu" style={{display:"flex",gap:24,marginBottom:36,animationDelay:".08s"}}>
        {[{val:members.length,label:"Members"},{val:[...tiers].reverse()[0]?.name||"Platinum",label:"Top Tier"},{val:tiers.length,label:"Tiers"}].map(s=>(
          <div key={s.label} style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,fontWeight:700,color:"#f5c842"}}>{s.val}</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#5a4a2a",letterSpacing:.8}}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="si" style={{width:"100%",background:"#14100a",border:"1px solid #3a2a12",borderRadius:22,padding:"32px 28px",animationDelay:".12s"}}>
        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:"#f7f2eb",fontWeight:600,marginBottom:6}}>Welcome back</div>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6a5a3a",marginBottom:24}}>Enter your mobile number to access your account</div>
        <label style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#8a6a3a",letterSpacing:1.5,textTransform:"uppercase",marginBottom:8,display:"block"}}>Mobile Number</label>
        <input value={phone} onChange={e=>{setPhone(fmtPhone(e.target.value));setErr("");}} onKeyDown={e=>e.key==="Enter"&&submitPhone()} placeholder="012-3456-789"
          inputMode="tel" autoComplete="tel"
          style={{width:"100%",background:"#0d0a06",border:"1px solid #3a2a12",borderRadius:12,color:"#f7f2eb",padding:"16px",fontSize:16,fontFamily:"'DM Sans',sans-serif",transition:"border-color .2s",marginBottom:8}}/>
        {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:12,fontFamily:"'DM Sans',sans-serif"}}>{err}</div>}

        <button onClick={submitPhone} style={{width:"100%",padding:"16px",background:"linear-gradient(135deg,#f5c842,#f59e0b)",borderRadius:14,fontSize:15,fontWeight:700,color:"#1a1208",fontFamily:"'DM Sans',sans-serif",letterSpacing:.3,boxShadow:"0 4px 20px #f5c84244",border:"none",transition:"all .2s"}}>
          Continue →
        </button>
      </div>
      <div className="fu" style={{marginTop:24,fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#3a2a12",textAlign:"center",animationDelay:".2s"}}>Real-time sync with Admin Portal via Firebase</div>
    </div>
  );
}

// ─── PORTAL ───────────────────────────────────────────────────────────────────
function Portal({member,members,tiers,refLevels,rewards,setMembers,showNotif,syncing,lastSync,onLogout}){
  const [tab,setTab]=useState("home");
  const [redeeming,setRedeeming]=useState(null);
  const [redeemed,setRedeemed]=useState([]);
  const [copied,setCopied]=useState(false);

  const tier=getTier(member.points,tiers);
  const nextTier=tiers.find(t=>t.minPoints>member.points);
  const downline=getDownline(members,member.id,refLevels.length);

  const handleRedeem=(reward)=>{
    setMembers(prev=>prev.map(m=>m.id===member.id?{...m,points:m.points-reward.pts,transactions:[{id:genId(),pts:-reward.pts,icon:reward.icon,label:`${reward.name} Redeemed`,date:today(),type:"redeem"},...m.transactions]}:m));
    setRedeemed(r=>[...r,reward.id]);
    setRedeeming(null);
    showNotif(`${reward.icon||"🎁"} ${reward.name} redeemed!`);
  };
  const copyRef=()=>{setCopied(true);showNotif("Referral code copied!");setTimeout(()=>setCopied(false),2000);};

  // Sync pulse when admin updates this member
  const syncRef=useRef(member.points);
  useEffect(()=>{if(syncRef.current!==member.points){showNotif("✦ Your points were updated by admin");syncRef.current=member.points;}});

  return(
    <div style={{flex:1,overflowY:"auto",paddingBottom:"calc(90px + env(safe-area-inset-bottom))",position:"relative"}}>
      {/* SYNC INDICATOR */}
      <div style={{position:"fixed",top:"max(12px, env(safe-area-inset-top))",right:12,display:"flex",alignItems:"center",gap:5,background:"rgba(247,242,235,.95)",backdropFilter:"blur(8px)",borderRadius:99,padding:"5px 10px",border:"1px solid #e0d4c0",zIndex:200,boxShadow:"0 2px 8px #00000015"}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:syncing?"#f59e0b":"#4ade80",boxShadow:`0 0 5px ${syncing?"#f59e0b":"#4ade80"}`,animation:syncing?"pulse .8s infinite":"none"}}/>
        <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"#9a8a7a",fontWeight:600}}>{syncing?"Syncing":"Real-time"}</span>
      </div>

      {/* LOGOUT */}
      <button onClick={onLogout} style={{position:"fixed",top:"max(12px, env(safe-area-inset-top))",left:12,background:"rgba(247,242,235,.9)",backdropFilter:"blur(8px)",border:"1px solid #e8ddd0",borderRadius:99,padding:"8px 14px",fontSize:11,fontWeight:600,color:"#9a8a7a",fontFamily:"'DM Sans',sans-serif",zIndex:200,minHeight:36}}>← Logout</button>

      {tab==="home"     && <HomeTab     member={member} tier={tier} nextTier={nextTier}/>}
      {tab==="rewards"  && <RewardsTab  member={member} tier={tier} rewards={rewards} redeemed={redeemed} redeeming={redeeming} setRedeeming={setRedeeming} onRedeem={handleRedeem}/>}
      {tab==="referral" && <ReferralTab member={member} members={members} refLevels={refLevels} downline={downline} copied={copied} onCopy={copyRef}/>}
      {tab==="history"  && <HistoryTab  member={member} tier={tier}/>}
      {tab==="profile"  && <ProfileTab  member={member} tier={tier} nextTier={nextTier} tiers={tiers} members={members} refLevels={refLevels} downline={downline} setMembers={setMembers} onLogout={onLogout}/>}

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(247,242,235,.96)",backdropFilter:"blur(20px)",borderTop:"1px solid #e8ddd0",paddingTop:10,paddingBottom:"max(20px, env(safe-area-inset-bottom))",display:"flex",justifyContent:"space-around",zIndex:100}}>
        {[{id:"home",icon:"⌂",label:"Home"},{id:"rewards",icon:"✦",label:"Rewards"},{id:"referral",icon:"◈",label:"Refer"},{id:"history",icon:"◷",label:"History"},{id:"profile",icon:"◉",label:"Profile"}].map(n=>(
          <button key={n.id} className="tab-btn" onClick={()=>setTab(n.id)} style={{background:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 12px"}}>
            <span style={{fontSize:20,color:tab===n.id?tier.color:"#b8aa9a",transition:"color .2s",lineHeight:1.1}}>{n.icon}</span>
            <span className="sans" style={{fontSize:10,fontWeight:600,color:tab===n.id?"#3a2a1a":"#b8aa9a",letterSpacing:.5,transition:"color .2s"}}>{n.label}</span>
            {tab===n.id&&<div style={{width:4,height:4,borderRadius:"50%",background:tier.color,marginTop:-2}}/>}
          </button>
        ))}
      </div>

      {/* REDEEM MODAL */}
      {redeeming&&<div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(20,15,8,.75)",backdropFilter:"blur(14px)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setRedeeming(null)}>
        <div className="si" onClick={e=>e.stopPropagation()} style={{background:"#f7f2eb",borderRadius:"24px 24px 0 0",padding:"32px 26px 48px",width:"100%",maxWidth:430}}>
          <div style={{width:40,height:4,background:"#e0d4c8",borderRadius:99,margin:"0 auto 28px"}}/>
          <div style={{textAlign:"center",marginBottom:28}}>
            {redeeming.image
              ?<img src={redeeming.image} alt={redeeming.name} style={{width:"100%",maxHeight:180,objectFit:"cover",borderRadius:14,marginBottom:12}}/>
              :<div style={{fontSize:56,marginBottom:12}}>{redeeming.icon||"🎁"}</div>}
            <div className="serif" style={{fontSize:26,color:"#2a1a0a",fontWeight:600,marginBottom:6}}>{redeeming.name}</div>
            <div className="sans" style={{fontSize:13,color:"#9a8a7a"}}>Deducts {redeeming.pts.toLocaleString()} points</div>
          </div>
          <div style={{background:"#fff8f0",borderRadius:14,padding:"16px 20px",marginBottom:14,display:"flex",justifyContent:"space-between"}}>
            <span className="sans" style={{fontSize:13,color:"#6a5a3a"}}>Current balance</span>
            <span className="sans" style={{fontSize:13,fontWeight:700,color:"#2a1a0a"}}>{member.points.toLocaleString()} pts</span>
          </div>
          <div style={{background:"#fff8f0",borderRadius:14,padding:"16px 20px",marginBottom:24,display:"flex",justifyContent:"space-between"}}>
            <span className="sans" style={{fontSize:13,color:"#6a5a3a"}}>After redemption</span>
            <span className="sans" style={{fontSize:13,fontWeight:700,color:tier.color}}>{(member.points-redeeming.pts).toLocaleString()} pts</span>
          </div>
          <button onClick={()=>handleRedeem(redeeming)} style={{width:"100%",padding:"17px",background:`linear-gradient(135deg,${tier.color},${tier.color}cc)`,borderRadius:14,fontSize:15,fontWeight:700,color:"#1a1208",fontFamily:"'DM Sans',sans-serif",letterSpacing:.3,boxShadow:`0 4px 20px ${tier.color}44`,border:"none"}}>Confirm Redemption</button>
        </div>
      </div>}
    </div>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({member,tier,nextTier}){
  const cnt=useCountUp(member.points);
  const progress=nextTier?((member.points-tier.minPoints)/(nextTier.minPoints-tier.minPoints))*100:100;
  return <div>
    <div style={{padding:"max(60px, calc(44px + env(safe-area-inset-top))) 20px 0",background:"linear-gradient(160deg,#1a1208 0%,#2a1f0e 60%,#1a1208 100%)",position:"relative",overflow:"hidden",paddingBottom:110}}>
      <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",background:`${tier.color}11`,border:`1px solid ${tier.color}22`}}/>
      <div style={{position:"absolute",bottom:40,left:-40,width:160,height:160,borderRadius:"50%",background:"#f5c84208"}}/>
      <div style={{position:"relative",zIndex:1}}>
        <div className="sans fu" style={{fontSize:11,color:"#8a7a5a",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Welcome back</div>
        <div className="fu serif" style={{fontSize:30,color:"#f7f2eb",fontWeight:600,marginBottom:4,animationDelay:".08s"}}>{member.name}</div>
        <div className="fu sans" style={{fontSize:12,color:tier.color,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",animationDelay:".14s"}}>{tier.icon} {tier.name} Member</div>
      </div>
    </div>
    {/* CARD */}
    <div style={{margin:"-80px 16px 0",position:"relative",zIndex:10}}>
      <div className="si" style={{background:"linear-gradient(135deg,#1e1508 0%,#2d2010 40%,#1a1208 100%)",borderRadius:22,padding:"28px 26px",position:"relative",overflow:"hidden",border:`1px solid ${tier.color}44`,boxShadow:`0 20px 60px #00000055,inset 0 1px 0 ${tier.color}33`}}>
        <div className="card-shine"/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
          <div>
            <div className="sans" style={{fontSize:9,color:tier.color,letterSpacing:3,textTransform:"uppercase",marginBottom:4}}>B LOYALTY MEMBER</div>
            <div className="serif" style={{fontSize:20,color:"#f7f2eb",fontWeight:600}}>{member.name}</div>
          </div>
          <div style={{textAlign:"right"}}><div style={{fontSize:28}}>{tier.icon}</div><div className="sans" style={{fontSize:10,color:tier.color,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>{tier.name}</div></div>
        </div>
        <div style={{marginBottom:22}}>
          <div className="sans" style={{fontSize:10,color:"#6a5a3a",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Available Points</div>
          <div className="serif" style={{fontSize:52,color:tier.color,fontWeight:700,lineHeight:1,letterSpacing:-1}}>{cnt.toLocaleString()}</div>
        </div>
        {nextTier?<div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
            <span className="sans" style={{fontSize:10,color:"#6a5a3a"}}>{tier.name}</span>
            <span className="sans" style={{fontSize:10,color:tier.color}}>{(nextTier.minPoints-member.points).toLocaleString()} pts to {nextTier.name}</span>
          </div>
          <PBar value={member.points-tier.minPoints} max={nextTier.minPoints-tier.minPoints} color={tier.color} h={5}/>
        </div>:<div className="sans" style={{fontSize:11,color:tier.color,fontWeight:600,letterSpacing:1,textAlign:"center"}}>✦ Highest Tier Achieved ✦</div>}
        <div style={{marginTop:20,paddingTop:16,borderTop:`1px solid ${tier.color}22`,display:"flex",justifyContent:"space-between"}}>
          <div className="sans" style={{fontSize:10,color:"#4a3a22"}}>{member.phone}</div>
          <div className="sans" style={{fontSize:10,color:"#4a3a22"}}>Since {member.joinedAt.slice(0,7)}</div>
        </div>
      </div>
    </div>
    {/* RECENT */}
    <div style={{padding:"28px 20px 0"}}>
      <div className="serif fu" style={{fontSize:20,color:"#2a1a0a",marginBottom:16,animationDelay:".3s"}}>Recent Activity</div>
      {member.transactions.slice(0,4).map((t,i)=>(
        <div key={t.id} className="fu" style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:"#fff8f0",borderRadius:14,border:"1px solid #e8ddd0",marginBottom:10,animationDelay:`${.35+i*.07}s`}}>
          <div style={{width:40,height:40,borderRadius:12,background:t.type==="earn"?"#f0fdf4":"#fff0f0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{t.icon}</div>
          <div style={{flex:1}}><div className="sans" style={{fontSize:13,fontWeight:600,color:"#2a1a0a"}}>{t.label}</div><div className="sans" style={{fontSize:11,color:"#9a8a7a",marginTop:2}}>{t.date}</div></div>
          <div className="sans" style={{fontSize:14,fontWeight:700,color:t.pts>0?"#16a34a":"#dc2626"}}>{t.pts>0?"+":""}{t.pts.toLocaleString()}</div>
        </div>
      ))}
    </div>
  </div>;
}

// ─── REWARDS TAB ─────────────────────────────────────────────────────────────
function RewardsTab({member,tier,rewards=[],redeemed,redeeming,setRedeeming,onRedeem}){
  const [filter,setFilter]=useState("All");
  const activeRewards=rewards.filter(r=>r.active!==false);
  const cats=["All",...new Set(activeRewards.map(r=>r.category).filter(Boolean))];
  const filtered=filter==="All"?activeRewards:activeRewards.filter(r=>r.category===filter);
  return <div>
    <div style={{padding:"max(60px,calc(44px + env(safe-area-inset-top))) 20px 20px",background:"linear-gradient(160deg,#1a1208,#2a1f0e)"}}>
      <div className="sans fu" style={{fontSize:11,color:"#8a7a5a",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Balance</div>
      <div className="serif fu" style={{fontSize:42,color:tier.color,fontWeight:700,animationDelay:".05s"}}>{member.points.toLocaleString()} <span style={{fontSize:18,color:"#6a5a3a"}}>pts</span></div>
    </div>
    <div style={{padding:"16px 20px 0",display:"flex",gap:8,overflowX:"auto"}}>
      {cats.map(c=><button key={c} onClick={()=>setFilter(c)} className="sans" style={{padding:"7px 16px",borderRadius:99,fontSize:12,fontWeight:600,border:"none",background:filter===c?tier.color:"#fff0e8",color:filter===c?"#1a1208":"#9a8a7a",whiteSpace:"nowrap",transition:"all .2s",flexShrink:0}}>{c}</button>)}
    </div>
    <div style={{padding:"16px 20px"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:12}}>
        {filtered.map((r,i)=>{
          const can=member.points>=r.pts;const done=redeemed.includes(r.id);
          return <div key={r.id} className="mem-reward fu" onClick={()=>!done&&can&&setRedeeming(r)} style={{background:done?"#f0fdf4":"#fff8f0",border:`1px solid ${done?"#86efac":can?"#e8ddd0":"#ede8e0"}`,borderRadius:18,padding:"20px 16px",cursor:done||!can?"default":"pointer",opacity:!can&&!done?.6:1,position:"relative",overflow:"hidden",animationDelay:`${i*.06}s`}}>
            {done&&<div style={{position:"absolute",top:10,right:10}}><span className="sans" style={{fontSize:9,background:"#16a34a",color:"#fff",padding:"2px 7px",borderRadius:99,fontWeight:700}}>DONE</span></div>}
            {r.image
              ?<img src={r.image} alt={r.name} style={{width:"100%",height:120,objectFit:"cover",borderRadius:10,marginBottom:10}}/>
              :<div style={{fontSize:32,marginBottom:10}}>{r.icon||"🎁"}</div>}
            <div className="serif" style={{fontSize:16,color:"#2a1a0a",fontWeight:600,marginBottom:4}}>{r.name}</div>
            <div className="sans" style={{fontSize:10,color:"#9a8a7a",marginBottom:10}}>{r.category}</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div className="sans" style={{fontSize:13,fontWeight:700,color:can?tier.color:"#c0b0a0"}}>{r.pts.toLocaleString()} pts</div>
              {!done&&<div style={{width:28,height:28,borderRadius:"50%",background:can?tier.color:"#e0d8d0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:can?"#1a1208":"#a09088"}}>→</div>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}

// ─── REFERRAL TAB ─────────────────────────────────────────────────────────────
function ReferralTab({member,members,refLevels,downline,copied,onCopy}){
  const totalEarned=member.transactions.filter(t=>t.label.includes("Override")||t.label.includes("Referral")).reduce((s,t)=>s+t.pts,0);
  return <div>
    <div style={{padding:"60px 24px 28px",background:"linear-gradient(160deg,#0a1f12,#0d2a18)"}}>
      <div className="sans fu" style={{fontSize:11,color:"#4a8a5a",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Referral Network</div>
      <div className="serif fu" style={{fontSize:26,color:"#f0fdf4",fontWeight:600,animationDelay:".06s"}}>Earn together, grow together</div>
    </div>
    <div style={{margin:"16px",background:"linear-gradient(135deg,#0d2a18,#163a24)",borderRadius:20,padding:"24px",border:"1px solid #1a4a28"}}>
      <div className="sans" style={{fontSize:10,color:"#4a8a5a",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Your Referral Code</div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div className="serif" style={{fontSize:26,color:"#86efac",fontWeight:700,letterSpacing:2,flex:1}}>{member.referralCode||"—"}</div>
        <button onClick={onCopy} className="sans" style={{background:copied?"#16a34a":"#1a4a28",color:copied?"#fff":"#86efac",border:"1px solid #1a6a38",borderRadius:10,padding:"9px 16px",fontSize:12,fontWeight:600,transition:"all .2s"}}>{copied?"✓ Copied":"Copy"}</button>
      </div>
    </div>
    <div style={{margin:"0 16px 20px",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
      {[{val:downline.filter(d=>d.level===1).length,label:"Direct Refs",color:"#f59e0b"},{val:downline.length,label:"Network",color:"#10b981"},{val:totalEarned,label:"Pts Earned",color:"#6366f1"}].map(s=>(
        <div key={s.label} style={{background:"#fff8f0",borderRadius:14,padding:"16px 12px",textAlign:"center",border:"1px solid #e8ddd0"}}>
          <div className="serif" style={{fontSize:22,color:s.color,fontWeight:700}}>{s.val}</div>
          <div className="sans" style={{fontSize:10,color:"#9a8a7a",marginTop:4}}>{s.label}</div>
        </div>
      ))}
    </div>
    <div style={{margin:"0 20px 20px"}}>
      <div className="serif" style={{fontSize:20,color:"#2a1a0a",marginBottom:14}}>Override Structure</div>
      {refLevels.map((rl,i)=>(
        <div key={rl.level} className="fu" style={{display:"flex",gap:14,marginBottom:12,animationDelay:`${i*.08}s`}}>
          <div style={{width:40,height:40,borderRadius:12,background:`${rl.color}18`,border:`1px solid ${rl.color}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span className="sans" style={{fontSize:13,fontWeight:800,color:rl.color}}>L{rl.level}</span>
          </div>
          <div style={{background:"#fff8f0",flex:1,borderRadius:14,padding:"12px 16px",border:"1px solid #e8ddd0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span className="sans" style={{fontSize:13,fontWeight:600,color:"#2a1a0a"}}>{rl.label}</span>
              <span className="sans" style={{fontSize:14,fontWeight:800,color:rl.color}}>{rl.overridePercent}%</span>
            </div>
            <div className="sans" style={{fontSize:11,color:"#9a8a7a"}}>You earn {rl.overridePercent}% of L{rl.level} network earnings</div>
          </div>
        </div>
      ))}
    </div>
    {downline.length>0&&<div style={{margin:"0 16px 24px"}}>
      <div className="serif" style={{fontSize:20,color:"#2a1a0a",marginBottom:14}}>My Network</div>
      {downline.map((d,i)=>{const dm=members.find(m=>m.id===d.id);const rl=refLevels.find(r=>r.level===d.level);if(!dm||!rl)return null;
        return <div key={d.id} className="fu" style={{display:"flex",alignItems:"center",gap:14,background:"#fff8f0",borderRadius:14,padding:"14px 16px",marginBottom:10,border:"1px solid #e8ddd0",animationDelay:`${i*.07}s`}}>
          <div style={{width:40,height:40,borderRadius:12,background:`${rl.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:rl.color,fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>L{d.level}</div>
          <div style={{flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span className="sans" style={{fontSize:13,fontWeight:600,color:"#2a1a0a"}}>{dm.name}</span>
              <span className="sans" style={{fontSize:11,color:rl.color,fontWeight:700,background:`${rl.color}18`,padding:"2px 8px",borderRadius:99}}>L{d.level}</span>
            </div>
            <div className="sans" style={{fontSize:11,color:"#9a8a7a",marginTop:2}}>{dm.points.toLocaleString()} pts · {rl.overridePercent}% override</div>
          </div>
        </div>;
      })}
    </div>}
  </div>;
}

// ─── HISTORY TAB ─────────────────────────────────────────────────────────────
function HistoryTab({member,tier}){
  const [filter,setFilter]=useState("all");
  const filtered=filter==="all"?member.transactions:member.transactions.filter(t=>t.type===filter);
  const earned =member.transactions.filter(t=>t.pts>0).reduce((s,t)=>s+t.pts,0);
  const spent  =member.transactions.filter(t=>t.pts<0).reduce((s,t)=>s+Math.abs(t.pts),0);
  return <div>
    <div style={{padding:"max(60px,calc(44px + env(safe-area-inset-top))) 20px 20px",background:"linear-gradient(160deg,#1a1208,#2a1f0e)"}}>
      <div className="sans fu" style={{fontSize:11,color:"#8a7a5a",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Points History</div>
      <div style={{display:"flex",gap:24}}>
        <div className="fu" style={{animationDelay:".05s"}}><div className="sans" style={{fontSize:10,color:"#4a6a4a",letterSpacing:1}}>EARNED</div><div className="serif" style={{fontSize:28,color:"#4ade80",fontWeight:700}}>+{earned.toLocaleString()}</div></div>
        <div style={{width:1,background:"#3a2a1a"}}/>
        <div className="fu" style={{animationDelay:".1s"}}><div className="sans" style={{fontSize:10,color:"#6a4a4a",letterSpacing:1}}>REDEEMED</div><div className="serif" style={{fontSize:28,color:"#f87171",fontWeight:700}}>-{spent.toLocaleString()}</div></div>
      </div>
    </div>
    <div style={{padding:"16px 20px 0",display:"flex",gap:8}}>
      {[["all","All"],["earn","Earned"],["redeem","Redeemed"]].map(([v,l])=><button key={v} onClick={()=>setFilter(v)} className="sans" style={{padding:"7px 16px",borderRadius:99,fontSize:12,fontWeight:600,border:"none",background:filter===v?tier.color:"#fff0e8",color:filter===v?"#1a1208":"#9a8a7a",transition:"all .2s"}}>{l}</button>)}
    </div>
    <div style={{padding:"16px 20px"}}>
      {filtered.map((t,i)=>(
        <div key={t.id} className="fu" style={{display:"flex",alignItems:"center",gap:14,background:"#fff8f0",borderRadius:16,padding:"16px 18px",border:"1px solid #e8ddd0",marginBottom:10,animationDelay:`${i*.06}s`}}>
          <div style={{width:44,height:44,borderRadius:14,background:t.type==="earn"?"#f0fdf4":"#fff0f0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{t.icon}</div>
          <div style={{flex:1}}><div className="sans" style={{fontSize:14,fontWeight:600,color:"#2a1a0a"}}>{t.label}</div><div className="sans" style={{fontSize:11,color:"#b0a090",marginTop:3}}>{t.date}</div></div>
          <div><div className="sans" style={{fontSize:16,fontWeight:800,color:t.type==="earn"?"#16a34a":"#dc2626",textAlign:"right"}}>{t.pts>0?"+":""}{t.pts.toLocaleString()}</div><div className="sans" style={{fontSize:10,color:"#b0a090",textAlign:"right"}}>pts</div></div>
        </div>
      ))}
    </div>
  </div>;
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────
function ProfileTab({member,tier,nextTier,tiers,members,refLevels,downline,setMembers,onLogout}){
  const progress=nextTier?((member.points-tier.minPoints)/(nextTier.minPoints-tier.minPoints))*100:100;
  const referrer=members.find(m=>m.id===member.referredBy);
  const [pinForm,setPinForm]=useState({current:"",next:"",confirm:""});
  const [pinErr,setPinErr]=useState("");
  const [pinOk,setPinOk]=useState("");
  const [pinSaving,setPinSaving]=useState(false);
  const [showPin,setShowPin]=useState(false);

  const changePin=async()=>{
    const currentPin=member.pin||"0000";
    if(pinForm.current!==currentPin){setPinErr("Current PIN is incorrect.");setPinOk("");return;}
    if(!/^\d{4}$/.test(pinForm.next)){setPinErr("New PIN must be exactly 4 digits.");setPinOk("");return;}
    if(pinForm.next!==pinForm.confirm){setPinErr("PINs do not match.");setPinOk("");return;}
    setPinSaving(true);
    try{
      await setMembers(prev=>prev.map(m=>m.id===member.id?{...m,pin:pinForm.next}:m));
      setPinForm({current:"",next:"",confirm:""});setPinErr("");
      setPinOk("PIN changed successfully!");
    }catch(e){setPinErr("Failed to save. Try again.");}
    setPinSaving(false);
  };

  return <div>
    <div style={{padding:"60px 0 40px",background:"linear-gradient(160deg,#1a1208,#2a1f0e)",textAlign:"center",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse at 50% 120%,${tier.color}15 0%,transparent 60%)`}}/>
      <div style={{width:80,height:80,borderRadius:"50%",background:`linear-gradient(135deg,${tier.color}33,${tier.color}11)`,border:`2px solid ${tier.color}55`,margin:"0 auto 16px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,position:"relative"}}>{tier.icon}</div>
      <div className="serif" style={{fontSize:26,color:"#f7f2eb",fontWeight:600}}>{member.name}</div>
      <div className="sans" style={{fontSize:12,color:tier.color,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",marginTop:4}}>{tier.name} Member</div>
      <div className="sans" style={{fontSize:12,color:"#6a5a3a",marginTop:6}}>{member.phone}</div>
    </div>

    <div style={{margin:"16px",background:"#fff8f0",borderRadius:16,padding:"22px",border:"1px solid #e8ddd0"}}>
      <div className="serif" style={{fontSize:18,color:"#2a1a0a",marginBottom:16}}>Tier Journey</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        {tiers.map(t=>{const achieved=member.points>=t.minPoints;return(
          <div key={t.id} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1,zIndex:1}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:achieved?`${t.color}22`:"#f0e8e0",border:`2px solid ${achieved?t.color:"#d0c8c0"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,marginBottom:6}}>{t.icon}</div>
            <div className="sans" style={{fontSize:9,fontWeight:700,color:achieved?t.color:"#b0a090",letterSpacing:.5,textTransform:"uppercase"}}>{t.name}</div>
          </div>
        );})}
      </div>
      {nextTier&&<><div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
        <span className="sans" style={{fontSize:11,color:"#9a8a7a"}}>Progress to {nextTier.name}</span>
        <span className="sans" style={{fontSize:11,color:tier.color,fontWeight:600}}>{(nextTier.minPoints-member.points).toLocaleString()} pts away</span>
      </div><PBar value={member.points-tier.minPoints} max={nextTier.minPoints-tier.minPoints} color={tier.color} h={8}/></>}
    </div>

    <div style={{margin:"0 16px 16px"}}>
      <div className="serif" style={{fontSize:20,color:"#2a1a0a",marginBottom:14}}>Membership Details</div>
      {[
        {label:"Member ID",val:member.id},{label:"Total Points",val:`${member.points.toLocaleString()} pts`},
        {label:"Tier Multiplier",val:`×${tier.multiplier} (${tier.name})`},{label:"Referral Code",val:member.referralCode||"—"},
        {label:"Referred By",val:referrer?referrer.name:"—"},{label:"Network Size",val:`${downline.length} members`},
        {label:"Date of Birth",val:member.birthday?(()=>{const p=member.birthday.split("-");if(p.length<2)return"Not set";const d=parseInt(p[1]);const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];return `${d} ${MONTHS[parseInt(p[0])-1]||""}`||"Not set"})():"Not set"},
        {label:"Joined",val:member.joinedAt},
      ].map((r,i)=>(
        <div key={r.label} className="fu" style={{display:"flex",justifyContent:"space-between",padding:"14px 16px",background:"#fff8f0",borderRadius:12,marginBottom:8,border:"1px solid #e8ddd0",animationDelay:`${i*.06}s`}}>
          <span className="sans" style={{fontSize:13,color:"#9a8a7a"}}>{r.label}</span>
          <span className="sans" style={{fontSize:13,fontWeight:600,color:"#2a1a0a"}}>{r.val}</span>
        </div>
      ))}
    </div>

    {/* CHANGE PIN */}
    <div style={{margin:"0 16px 16px",background:"#fff8f0",borderRadius:20,border:"1px solid #e8ddd0",overflow:"hidden"}}>
      <button onClick={()=>{setShowPin(s=>!s);setPinErr("");setPinOk("");setPinForm({current:"",next:"",confirm:""}); }} 
        style={{width:"100%",padding:"18px 22px",background:"none",border:"none",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18}}>🔑</span>
          <div style={{textAlign:"left"}}>
            <div className="sans" style={{fontSize:14,fontWeight:600,color:"#2a1a0a"}}>Change PIN</div>
            <div className="sans" style={{fontSize:11,color:"#9a8a7a"}}>Update your 4-digit login PIN</div>
          </div>
        </div>
        <span style={{color:"#b8aa9a",fontSize:18,transform:showPin?"rotate(90deg)":"none",transition:"transform .2s"}}>›</span>
      </button>
      {showPin&&<div style={{padding:"0 22px 22px",borderTop:"1px solid #e8ddd0"}}>
        {[
          {key:"current",label:"Current PIN",placeholder:"••••"},
          {key:"next",   label:"New PIN",    placeholder:"••••"},
          {key:"confirm",label:"Confirm PIN",placeholder:"••••"},
        ].map(({key,label,placeholder})=>(
          <div key={key} style={{marginTop:14}}>
            <label className="sans" style={{fontSize:11,fontWeight:600,color:"#9a8a7a",letterSpacing:.8,textTransform:"uppercase",display:"block",marginBottom:6}}>{label}</label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={4}
              placeholder={placeholder}
              value={pinForm[key]}
              onChange={e=>{ setPinForm(f=>({...f,[key]:e.target.value.replace(/\D/g,"").slice(0,4)})); setPinErr(""); setPinOk(""); }}
              onKeyDown={e=>e.key==="Enter"&&changePin()}
              style={{width:"100%",background:"#f7f0e8",border:"1px solid #e0d4c0",borderRadius:10,color:"#2a1a0a",padding:"16px",fontSize:16,fontFamily:"'DM Sans',sans-serif",letterSpacing:8,outline:"none"}}/>
          </div>
        ))}
        {pinErr&&<div className="sans" style={{color:"#dc2626",fontSize:12,marginTop:10,background:"#fff0f0",borderRadius:8,padding:"8px 12px",border:"1px solid #fca5a5"}}>{pinErr}</div>}
        {pinOk&&<div className="sans" style={{color:"#16a34a",fontSize:12,marginTop:10,background:"#f0fff4",borderRadius:8,padding:"8px 12px",border:"1px solid #86efac"}}>{pinOk}</div>}
        <button onClick={changePin} disabled={pinSaving}
          style={{marginTop:16,width:"100%",padding:"13px",background:`linear-gradient(135deg,${tier.color},${tier.color}cc)`,borderRadius:12,fontSize:14,fontWeight:700,color:"#1a1208",fontFamily:"'DM Sans',sans-serif",border:"none",cursor:"pointer",opacity:pinSaving?0.6:1}}>
          {pinSaving?"Saving…":"Save New PIN"}
        </button>
      </div>}
    </div>

    {/* LOGOUT */}
    <div style={{margin:"0 20px 32px"}}>
      <button onClick={onLogout}
        style={{width:"100%",padding:"14px",background:"#fff0f0",border:"1px solid #fca5a5",borderRadius:14,fontSize:14,fontWeight:600,color:"#dc2626",fontFamily:"'DM Sans',sans-serif",cursor:"pointer",letterSpacing:.3}}>
        ⎋ Logout
      </button>
    </div>
  </div>;
}
