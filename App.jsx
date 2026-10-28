import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
// ─── Theme ────────────────────────────────────────────────────────────────────
const LIGHT = {
  bg:"#f7f7f5", surface:"#ffffff", border:"#ebebeb", text:"#111111",
  sub:"#777777", muted:"#bbbbbb", accent:"#f59e0b", accentText:"#111",
  input:"#ffffff", inputBorder:"#e0e0e0", navBg:"#ffffff",
  msgUser:"#111111", msgUserText:"#ffffff", msgOther:"#f0f0f0", msgOtherText:"#111",
  roomBar:"#fafafa", tag:"#f0f0f0", tagText:"#555",
  breakBg:"rgba(245,158,11,0.08)", cardHover:"0 6px 28px rgba(0,0,0,0.08)"
};
const DARK = {
  bg:"#0f0f0f", surface:"#1a1a1a", border:"#2a2a2a", text:"#f0f0f0",
  sub:"#888888", muted:"#444444", accent:"#f59e0b", accentText:"#111",
  input:"#222222", inputBorder:"#333333", navBg:"#141414",
  msgUser:"#f59e0b", msgUserText:"#111", msgOther:"#252525", msgOtherText:"#f0f0f0",
  roomBar:"#161616", tag:"#252525", tagText:"#aaa",
  breakBg:"rgba(245,158,11,0.12)", cardHover:"0 6px 28px rgba(0,0,0,0.4)"
};

// ─── Data ─────────────────────────────────────────────────────────────────────
const SUBJECTS = ["Mathematics","Physics","Chemistry","Biology","History","Literature","Computer Science","Economics","Psychology","Philosophy","Law","Medicine","Engineering","Languages","Accounting","Finance","Business"];

const AVATARS = { A:"#e8d5b7",M:"#c9e4ca",Y:"#c6def1",J:"#f9c6c9",P:"#e2cfea",S:"#fde68a",O:"#d1fae5",N:"#fce7f3",L:"#dbeafe" };
function avatarBg(l){ return AVATARS[l] || "#e0e0e0"; }

const MOCK_PARTNERS = [
  {id:1,name:"Aisha K.",subject:"Mathematics",topics:["Calculus","Linear Algebra"],level:"University",status:"online",streak:12,avatar:"A",bio:"Calculus & Linear Algebra. Evening sessions."},
  {id:2,name:"Marco R.",subject:"Computer Science",topics:["Python","Algorithms","Data Structures"],level:"University",status:"online",streak:8,avatar:"M",bio:"Python & algorithms. Looking for coding buddies."},
  {id:3,name:"Yuna L.",subject:"Medicine",topics:["Anatomy","Physiology","Pharmacology"],level:"Postgrad",status:"away",streak:21,avatar:"Y",bio:"Med student grinding anatomy. Morning studier."},
  {id:4,name:"Sara M.",subject:"Accounting",topics:["ACCA","ACCA P3","ACCA F7","Intermediate Accounting"],level:"Postgrad",status:"online",streak:9,avatar:"S",bio:"ACCA P3 & F7. Happy to form study groups."},
  {id:5,name:"Omar F.",subject:"Accounting",topics:["Intermediate Accounting","IFRS","Auditing"],level:"University",status:"online",streak:6,avatar:"O",bio:"IFRS & Intermediate Accounting."},
  {id:6,name:"Nina R.",subject:"Finance",topics:["CFA","CFA Level 1","Financial Analysis"],level:"Postgrad",status:"away",streak:17,avatar:"N",bio:"CFA Level 1 candidate."},
];

const MOCK_POSTS = [
  {id:1,author:"Aisha K.",avatar:"A",subject:"Mathematics",topics:["Calculus"],time:"2h ago",title:"Best way to understand eigenvectors?",body:"Struggling with the intuition. Any good analogy?",replies:4,likes:11},
  {id:2,author:"Sara M.",avatar:"S",subject:"Accounting",topics:["ACCA","ACCA P3"],time:"3h ago",title:"ACCA P3 — anyone doing the June sitting?",body:"Looking for a group for P3 Business Analysis. The strategic models section is dense.",replies:5,likes:14},
  {id:3,author:"Omar F.",avatar:"O",subject:"Accounting",topics:["IFRS"],time:"5h ago",title:"IFRS 16 lease accounting — anyone else struggling?",body:"Right-of-use assets under IFRS 16 is tricky. Good practice problems?",replies:3,likes:9},
];

// ─── Supabase helpers ─────────────────────────────────────────────────────────
function profileToUser(p){
  return {
    id: p.id,
    name: p.display_name,
    avatar: p.avatar || (p.display_name?.[0] || "?").toUpperCase(),
    level: p.level || "",
    subjects: p.subjects || [],
    topics: p.topics || [],
    bio: p.bio || "",
    streak: p.streak || 0,
  };
}

function mapRoom(row, user){
  const hostName = row.host?.display_name || "Host";
  const hostAvatar = row.host?.avatar || hostName[0];
  const members = [{name:hostName,avatar:hostAvatar,status:"studying",page:1,id:row.host_id}];
  if(user && user.id !== row.host_id){
    members.push({name:user.name,avatar:user.avatar,status:"studying",page:1,id:user.id});
  }
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    topic: row.topic || "",
    host: hostName,
    hostAvatar,
    host_id: row.host_id,
    capacity: row.capacity,
    members,
    isPrivate: row.is_private,
    aiMode: row.ai_mode,
  };
}

function mapMessage(row, user){
  const name = row.author?.display_name || "Member";
  const isMe = row.user_id === user.id;
  return {
    id: row.id,
    author: isMe ? "You" : name,
    avatar: isMe ? (user.avatar || "?") : (row.author?.avatar || name[0]),
    text: row.content,
    time: new Date(row.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}),
    user_id: row.user_id,
  };
}

async function fetchProfile(userId){
  for(let i=0;i<10;i++){
    const {data} = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if(data) return data;
    await new Promise(r=>setTimeout(r, 250));
  }
  return null;
}

async function fetchRooms(user){
  const {data, error} = await supabase
    .from("rooms")
    .select("*, host:profiles!host_id(display_name, avatar)")
    .order("created_at", {ascending:false});
  if(error) throw error;
  return (data||[]).map(r=>mapRoom(r, user));
}
// Initialize the Gemini client using your Vite environment variable
async function callClaude(messages, system = "") {
  try {
    // Format the incoming messages into what Gemini expects
    let formattedContents = messages;
    if (Array.isArray(messages)) {
      formattedContents = messages.map(m => `${m.role || 'user'}: ${m.content}`).join('\n');
    }

    // Combine system prompt if it exists
    const fullPrompt = system ? `System Instructions: ${system}\n\n${formattedContents}` : formattedContents;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash', // Fast, powerful, and completely free tier friendly
      contents: fullPrompt,
    });
    
    return response.text || "Sorry, couldn't get a response.";
  } catch (error) {
    console.error("Error communicating with Gemini AI:", error);
    return "Sorry, couldn't get a response due to an error.";
  }
}

function matchQ(fields,q){ if(!q)return true; const l=q.toLowerCase(); return fields.some(f=>f&&f.toLowerCase().includes(l)); }
function hl(text,q){
  if(!q||typeof text!=="string")return text;
  const i=text.toLowerCase().indexOf(q.toLowerCase());
  if(i===-1)return text;
  return <>{text.slice(0,i)}<mark style={{background:"#fef08a",borderRadius:2,padding:"0 1px",color:"#111"}}>{text.slice(i,i+q.length)}</mark>{text.slice(i+q.length)}</>;
}

// ─── Micro UI ─────────────────────────────────────────────────────────────────
function Av({letter,size=36,T}){
  const bg=letter==="?"?T.accent:avatarBg(letter);
  const col=letter==="?"?T.accentText:"#1a1a2e";
  return <div style={{width:size,height:size,borderRadius:"50%",background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:size*0.38,color:col,flexShrink:0,fontFamily:"'Playfair Display',serif"}}>{letter==="?"?"Y":letter}</div>;
}
function Tag({label,T}){return <span style={{background:T.tag,color:T.tagText,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{label}</span>;}
function SearchBar({value,onChange,placeholder,T}){
  return <div style={{position:"relative"}}>
    <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",opacity:0.35,pointerEvents:"none",fontSize:14}}>🔍</span>
    <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",padding:"12px 38px 12px 38px",borderRadius:13,border:`1.5px solid ${T.inputBorder}`,fontSize:14,color:T.text,background:T.input,outline:"none",fontFamily:"'Sora',sans-serif",boxSizing:"border-box",transition:"border-color 0.15s"}}
      onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.inputBorder}/>
    {value&&<button onClick={()=>onChange("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:T.tag,border:"none",borderRadius:"50%",width:20,height:20,cursor:"pointer",fontSize:12,color:T.sub,padding:0}}>×</button>}
  </div>;
}
function Btn({children,onClick,variant="dark",T,disabled,style={}}){
  const base={padding:"10px 20px",borderRadius:11,fontWeight:700,fontSize:13,border:"none",cursor:disabled?"not-allowed":"pointer",fontFamily:"'Sora',sans-serif",opacity:disabled?0.45:1,transition:"opacity 0.15s",...style};
  const vars={dark:{background:T.text,color:T.bg},accent:{background:T.accent,color:T.accentText},ghost:{background:"transparent",color:T.sub,border:`1px solid ${T.border}`}};
  return <button onClick={disabled?undefined:onClick} style={{...base,...vars[variant]}}>{children}</button>;
}

// ─── Onboarding / Auth ────────────────────────────────────────────────────────
function Onboarding({onDone,T,showToast}){
  const [mode,setMode]=useState("welcome"); // welcome | login | signup
  const [step,setStep]=useState(0);
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [level,setLevel]=useState("");
  const [subjects,setSubjects]=useState([]);
  const [ti,setTi]=useState("");
  const [topics,setTopics]=useState([]);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [confirmNote,setConfirmNote]=useState("");
  const toggleS=s=>setSubjects(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const addT=()=>{const t=ti.trim();if(t&&!topics.includes(t))setTopics(p=>[...p,t]);setTi("");};
  const inp={padding:"12px 14px",borderRadius:11,border:`1.5px solid ${T.inputBorder}`,fontSize:15,color:T.text,background:T.input,fontFamily:"'Sora',sans-serif",outline:"none",width:"100%",boxSizing:"border-box"};

  const finishSignup=async()=>{
    setBusy(true);setErr("");
    const {data, error} = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          display_name: name.trim(),
          level,
          subjects,
          topics,
        }
      }
    });
    if(error){setErr(error.message);setBusy(false);return;}
    if(!data.session){
      setConfirmNote("Account created. Confirm your email, then sign in.");
      setMode("login");
      setBusy(false);
      showToast("Check your email to confirm, then sign in.");
      return;
    }
    const profile = await fetchProfile(data.user.id);
    if(profile){
      await supabase.from("profiles").update({
        display_name: name.trim(),
        avatar: name.trim()[0].toUpperCase(),
        level,
        subjects,
        topics,
      }).eq("id", data.user.id);
      const updated = await fetchProfile(data.user.id);
      onDone(profileToUser(updated || profile));
    } else {
      setErr("Profile was not created. Try signing in in a moment.");
    }
    setBusy(false);
  };

  const signIn=async()=>{
    setBusy(true);setErr("");
    const {data, error} = await supabase.auth.signInWithPassword({email:email.trim(), password});
    if(error){setErr(error.message);setBusy(false);return;}
    const profile = await fetchProfile(data.user.id);
    if(!profile){setErr("Couldn't load your profile yet. Try again.");setBusy(false);return;}
    onDone(profileToUser(profile));
    setBusy(false);
  };

  if(mode==="welcome"){
    return (
      <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Sora',sans-serif"}}>
        <div style={{background:T.surface,borderRadius:24,padding:"40px 36px",width:"100%",maxWidth:440,boxShadow:"0 8px 40px rgba(0,0,0,0.12)",display:"flex",flexDirection:"column",alignItems:"center",gap:20,textAlign:"center"}}>
          <div style={{fontSize:54}}>📚</div>
          <h2 style={{margin:0,fontFamily:"'Playfair Display',serif",fontSize:30,color:T.text}}>Welcome to StudyBuddy</h2>
          <p style={{margin:0,color:T.sub,fontSize:15,maxWidth:320,lineHeight:1.7}}>Find study partners, join rooms, share resources, and let AI teach you — all in one place.</p>
          <Btn onClick={()=>setMode("signup")} T={T} variant="accent">Get started →</Btn>
          <button onClick={()=>setMode("login")} style={{background:"none",border:"none",color:T.sub,fontSize:13,cursor:"pointer",fontFamily:"'Sora',sans-serif"}}>Already have an account? Sign in</button>
        </div>
      </div>
    );
  }

  if(mode==="login"){
    return (
      <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Sora',sans-serif"}}>
        <div style={{background:T.surface,borderRadius:24,padding:"40px 36px",width:"100%",maxWidth:440,boxShadow:"0 8px 40px rgba(0,0,0,0.12)",display:"flex",flexDirection:"column",gap:14}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,color:T.text}}>Sign in</div>
          {confirmNote&&<div style={{fontSize:13,color:T.accent,lineHeight:1.5}}>{confirmNote}</div>}
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={inp} autoFocus/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" style={inp} onKeyDown={e=>e.key==="Enter"&&email&&password&&signIn()}/>
          {err&&<div style={{fontSize:13,color:"#ef4444"}}>{err}</div>}
          <Btn onClick={signIn} T={T} variant="accent" disabled={busy||!email.trim()||!password}> {busy?"Signing in…":"Sign in"}</Btn>
          <button onClick={()=>{setMode("signup");setErr("");}} style={{background:"none",border:"none",color:T.sub,fontSize:13,cursor:"pointer",padding:0,fontFamily:"'Sora',sans-serif"}}>Need an account? Create one</button>
        </div>
      </div>
    );
  }

  const steps=[
    <div key={0} style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:T.text}}>What's your name?</div>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your first name…" style={inp} autoFocus onKeyDown={e=>e.key==="Enter"&&name.trim()&&setStep(1)}/>
      <Btn onClick={()=>name.trim()&&setStep(1)} T={T} disabled={!name.trim()}>Continue →</Btn>
    </div>,
    <div key={1} style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:T.text}}>Create your account</div>
      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={inp}/>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password (min 6 characters)" style={inp}/>
      <Btn onClick={()=>email.trim()&&password.length>=6&&setStep(2)} T={T} disabled={!email.trim()||password.length<6}>Continue →</Btn>
    </div>,
    <div key={2} style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:T.text}}>Your study level?</div>
      {["High School","Undergraduate","Postgraduate","Professional / Self-study"].map(l=>(
        <button key={l} onClick={()=>{setLevel(l);setStep(3);}} style={{padding:"13px 16px",borderRadius:11,border:`1.5px solid ${level===l?T.text:T.border}`,background:level===l?T.text:T.surface,color:level===l?T.bg:T.text,fontWeight:500,fontSize:14,cursor:"pointer",textAlign:"left",fontFamily:"'Sora',sans-serif",transition:"all 0.15s"}}>{l}</button>
      ))}
    </div>,
    <div key={3} style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:T.text}}>What do you study?</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
        {SUBJECTS.map(s=>(
          <button key={s} onClick={()=>toggleS(s)} style={{padding:"7px 14px",borderRadius:20,border:`1.5px solid ${subjects.includes(s)?T.text:T.border}`,background:subjects.includes(s)?T.text:T.surface,color:subjects.includes(s)?T.bg:T.sub,fontSize:13,cursor:"pointer",fontFamily:"'Sora',sans-serif",transition:"all 0.15s"}}>{s}</button>
        ))}
      </div>
      <Btn onClick={()=>subjects.length&&setStep(4)} T={T} disabled={!subjects.length}>Continue →</Btn>
    </div>,
    <div key={4} style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,color:T.text}}>Specific courses or topics?</div>
      <p style={{margin:0,fontSize:13,color:T.sub,lineHeight:1.6}}>e.g. "ACCA P3", "CFA Level 1", "Calculus 2", "Organic Chemistry"</p>
      <div style={{display:"flex",gap:8}}>
        <input value={ti} onChange={e=>setTi(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addT()} placeholder="Type and press Enter…" style={{...inp,flex:1}}/>
        <Btn onClick={addT} T={T} variant="ghost">Add</Btn>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {topics.map(t=><span key={t} style={{background:T.text,color:T.bg,borderRadius:20,padding:"4px 12px",fontSize:12,display:"flex",alignItems:"center",gap:5}}>{t}<button onClick={()=>setTopics(p=>p.filter(x=>x!==t))} style={{background:"none",border:"none",color:T.bg,cursor:"pointer",opacity:.6,padding:0,fontSize:13}}>×</button></span>)}
      </div>
      {err&&<div style={{fontSize:13,color:"#ef4444"}}>{err}</div>}
      <Btn onClick={finishSignup} T={T} variant="accent" style={{marginTop:4}} disabled={busy}> {busy?"Creating account…":"🚀 Enter StudyBuddy"}</Btn>
    </div>
  ];
  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Sora',sans-serif"}}>
      <div style={{background:T.surface,borderRadius:24,padding:"40px 36px",width:"100%",maxWidth:440,boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
        <div style={{display:"flex",gap:4,marginBottom:26}}>{[0,1,2,3,4].map(i=><div key={i} style={{flex:1,height:3,borderRadius:3,background:i<=step?T.accent:T.border,transition:"background 0.3s"}}/>)}</div>
        {steps[step]}
        {step>0&&step<4&&!busy&&<button onClick={()=>setStep(s=>s-1)} style={{marginTop:10,background:"none",border:"none",color:T.muted,fontSize:13,cursor:"pointer",padding:0,fontFamily:"'Sora',sans-serif"}}>← Back</button>}
        <button onClick={()=>{setMode("login");setErr("");}} style={{marginTop:12,background:"none",border:"none",color:T.sub,fontSize:13,cursor:"pointer",padding:0,fontFamily:"'Sora',sans-serif"}}>Already have an account? Sign in</button>
      </div>
    </div>
  );
}

// ─── Study Room ───────────────────────────────────────────────────────────────
function StudyRoom({room,user,T,onLeave,showToast}){
  const [members]=useState(room.members);
  const [chatMsgs,setChatMsgs]=useState([]);
  const [chatLoading,setChatLoading]=useState(true);
  const [chatInput,setChatInput]=useState("");
  const [resources,setResources]=useState([]);
  const [activeRes,setActiveRes]=useState(null);
  const [aiMsgs,setAiMsgs]=useState([{role:"assistant",content:`Hi! I'm your AI tutor for this session. I can explain concepts, quiz you, or walk through documents. What would you like to work on?`}]);
  const [aiInput,setAiInput]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [pdfText,setPdfText]=useState("");
  const [activePanel,setActivePanel]=useState("chat");
  const [breakState,setBreakState]=useState(null);
  const [breakVotes,setBreakVotes]=useState({});
  const [breakTimer,setBreakTimer]=useState(300);
  const [uploading,setUploading]=useState(false);
  const [myPage,setMyPage]=useState(1);
  const chatRef=useRef(),aiRef=useRef(),fileRef=useRef(),timerRef=useRef();

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const {data, error}=await supabase
        .from("messages")
        .select("id, content, created_at, user_id, author:profiles!user_id(display_name, avatar)")
        .eq("room_id", room.id)
        .order("created_at", {ascending:true});
      if(cancelled) return;
      if(error){showToast(error.message);setChatLoading(false);return;}
      setChatMsgs((data||[]).map(row=>mapMessage(row, user)));
      setChatLoading(false);
    })();

    const channel=supabase
      .channel(`room-chat:${room.id}`)
      .on("postgres_changes", {event:"INSERT", schema:"public", table:"messages", filter:`room_id=eq.${room.id}`}, async (payload)=>{
        const row=payload.new;
        setChatMsgs(p=>{
          if(p.some(m=>m.id===row.id)) return p;
          return [...p, {id:row.id, author: row.user_id===user.id?"You":"Member", avatar: row.user_id===user.id?(user.avatar||"?"):"?", text:row.content, time:new Date(row.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}), user_id:row.user_id}];
        });
        const {data:author}=await supabase.from("profiles").select("display_name, avatar").eq("id", row.user_id).maybeSingle();
        if(!author) return;
        setChatMsgs(p=>p.map(m=>m.id===row.id && m.author!=="You" ? {...m, author:author.display_name, avatar:author.avatar||author.display_name[0]} : m));
      })
      .subscribe();

    return ()=>{
      cancelled=true;
      supabase.removeChannel(channel);
    };
  },[room.id, user]);

  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},[chatMsgs]);
  useEffect(()=>{if(aiRef.current)aiRef.current.scrollTop=aiRef.current.scrollHeight;},[aiMsgs]);
  useEffect(()=>{
    if(breakState==="active"){
      timerRef.current=setInterval(()=>setBreakTimer(t=>{if(t<=1){clearInterval(timerRef.current);setBreakState(null);setBreakTimer(300);showToast("Break over! Back to studying 📚");return 300;}return t-1;}),1000);
    } else clearInterval(timerRef.current);
    return ()=>clearInterval(timerRef.current);
  },[breakState]);

  const sendChat=async()=>{
    const t=chatInput.trim();if(!t)return;
    setChatInput("");
    const {data, error}=await supabase.from("messages").insert({
      room_id: room.id,
      user_id: user.id,
      content: t,
    }).select("id, content, created_at, user_id, author:profiles!user_id(display_name, avatar)").single();
    if(error){showToast(error.message);setChatInput(t);return;}
    const mapped=mapMessage(data, user);
    setChatMsgs(p=>p.some(m=>m.id===mapped.id)?p:[...p, mapped]);
  };

  const sendAi=async()=>{
    const msg=aiInput.trim();if(!msg||aiLoading)return;
    const userMsg={role:"user",content:msg};
    const hist=[...aiMsgs,userMsg];
    setAiMsgs(hist);setAiInput("");setAiLoading(true);
    const ctx=pdfText?`\n\nDOCUMENT:\n${pdfText.slice(0,5000)}`:"";
    const sys=`You are a helpful AI study tutor in a group study room. The room is studying "${room.topic}" (${room.subject}). Be clear, educational, and encouraging.${ctx}`;
    const reply=await callClaude(hist.filter(m=>m.role!=="system"),sys);
    setAiMsgs(p=>[...p,{role:"assistant",content:reply}]);
    setAiLoading(false);
  };

  const requestBreak=()=>{
    if(room.aiMode){setBreakState("voting");setBreakVotes({You:null});}
    else{setBreakState("active");showToast("Break started! ⏸");}
  };

  const voteBreak=(yes)=>{
    const v={...breakVotes,You:yes};
    setBreakVotes(v);
    setTimeout(()=>{ setBreakState("active"); showToast("Everyone agreed! Break time ☕"); },800);
  };

  const handleUpload=async(e)=>{
    const file=e.target.files[0];if(!file||file.type!=="application/pdf"){showToast("PDF only please");return;}
    setUploading(true);
    const reader=new FileReader();
    reader.onload=async(ev)=>{
      const b64=ev.target.result.split(",")[1];
      try{
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [
            {
              inlineData: {
                mimeType: "application/pdf",
                data: b64
              }
            },
            {
              text: "Extract the full readable text of this PDF. Just the text."
            }
          ]
        });
        const text = response.text || "";
        const nr={id:Date.now(),name:file.name,uploader:"You",avatar:"?",size:`${(file.size/1024/1024).toFixed(1)} MB`,_text:text};
        setResources(p=>[nr,...p]);
        setActiveRes(nr);setPdfText(text);setActivePanel("ai");
        setAiMsgs([{role:"assistant",content:`I've read **${file.name}**. Ask me anything — summaries, explanations, practice questions, key concepts!`}]);
        showToast("File uploaded & ready!");
        await supabase.from("messages").insert({room_id:room.id, user_id:user.id, content:`📄 Shared a resource: ${file.name}`});
      }catch(err){
        console.error("PDF upload error:", err);
        showToast("Upload failed");
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const fmt=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  const statusColors={studying:T.accent,break:"#60a5fa",away:"#aaa"};
  const panels=["chat","resources","ai"];
  const panelIcons={"chat":"💬","resources":"📄","ai":"🤖"};
  const panelLabels={"chat":"Chat","resources":"Resources","ai":"AI Tutor"};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 58px)",overflow:"hidden"}}>
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"10px 20px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onLeave} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,color:T.sub,fontFamily:"'Sora',sans-serif"}}>← Leave</button>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:16,color:T.text,fontFamily:"'Playfair Display',serif"}}>{room.name}</div>
          <div style={{fontSize:11,color:T.sub}}>{room.subject} · {room.aiMode?"AI-guided session":"Open session"} · {members.length}/{room.capacity} members</div>
        </div>
        {breakState==="active"?
          <div style={{background:T.breakBg,border:`1px solid ${T.accent}`,borderRadius:10,padding:"6px 14px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:14}}>☕</span><span style={{fontWeight:700,color:T.accent,fontSize:14}}>{fmt(breakTimer)}</span>
            <button onClick={()=>{setBreakState(null);setBreakTimer(300);showToast("Break ended!");}} style={{background:T.accent,border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:T.accentText,fontFamily:"'Sora',sans-serif"}}>End break</button>
          </div>
          :breakState==="voting"?
          <div style={{background:T.breakBg,border:`1px solid ${T.accent}`,borderRadius:10,padding:"6px 14px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:12,color:T.accent,fontWeight:600}}>Break vote:</span>
            <button onClick={()=>voteBreak(true)} style={{background:"#4ade80",border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:12,fontWeight:700,color:"#111",fontFamily:"'Sora',sans-serif"}}>✓ Yes</button>
            <button onClick={()=>{setBreakState(null);showToast("Break cancelled");}} style={{background:T.tag,border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:12,color:T.sub,fontFamily:"'Sora',sans-serif"}}>✗ No</button>
          </div>
          :
          <button onClick={requestBreak} style={{background:T.tag,border:"none",borderRadius:9,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:600,color:T.sub,fontFamily:"'Sora',sans-serif",display:"flex",alignItems:"center",gap:6}}>
            ☕ {room.aiMode?"Request break":"Take break"}
          </button>
        }
        <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}} onChange={handleUpload}/>
        <button onClick={()=>fileRef.current.click()} disabled={uploading} style={{background:T.accent,border:"none",borderRadius:9,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:700,color:T.accentText,fontFamily:"'Sora',sans-serif",opacity:uploading?.6:1}}>
          {uploading?"⏳":"⬆"} {uploading?"Reading…":"Upload PDF"}
        </button>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
        <div style={{width:190,background:T.roomBar,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",flexShrink:0,overflowY:"auto"}}>
          <div style={{padding:"12px 14px 8px",fontSize:11,fontWeight:700,color:T.muted,textTransform:"uppercase",letterSpacing:0.6}}>Members</div>
          {members.map((m,i)=>(
            <div key={m.id||i} style={{padding:"8px 14px",display:"flex",flexDirection:"column",gap:3}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{position:"relative",flexShrink:0}}>
                  <Av letter={m.avatar} size={28} T={T}/>
                  <div style={{position:"absolute",bottom:0,right:0,width:8,height:8,borderRadius:"50%",background:statusColors[m.status]||"#aaa",border:`1.5px solid ${T.roomBar}`}}/>
                </div>
                <span style={{fontSize:12,fontWeight:600,color:m.id===user.id||m.name==="You"?T.accent:T.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.id===user.id?"You":m.name}</span>
              </div>
              <div style={{paddingLeft:36,fontSize:10,color:T.sub}}>
                {m.status==="break"?"☕ On break":`📖 Page ${m.id===user.id?myPage:m.page}`}
              </div>
            </div>
          ))}
          <div style={{padding:"12px 14px 4px",marginTop:"auto",borderTop:`1px solid ${T.border}`}}>
            <div style={{fontSize:11,color:T.sub,marginBottom:6}}>Your page</div>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <button onClick={()=>setMyPage(p=>Math.max(1,p-1))} style={{background:T.tag,border:"none",borderRadius:6,width:24,height:24,cursor:"pointer",fontSize:14,color:T.text,fontWeight:700}}>-</button>
              <span style={{fontSize:13,fontWeight:700,color:T.text,minWidth:24,textAlign:"center"}}>{myPage}</span>
              <button onClick={()=>setMyPage(p=>p+1)} style={{background:T.tag,border:"none",borderRadius:6,width:24,height:24,cursor:"pointer",fontSize:14,color:T.text,fontWeight:700}}>+</button>
            </div>
          </div>
        </div>

        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
          <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"0 16px",display:"flex",gap:2,flexShrink:0}}>
            {panels.map(p=>(
              <button key={p} onClick={()=>setActivePanel(p)}
                style={{padding:"10px 16px",background:"none",border:"none",borderBottom:`2px solid ${activePanel===p?T.accent:"transparent"}`,color:activePanel===p?T.text:T.sub,fontWeight:activePanel===p?700:400,fontSize:13,cursor:"pointer",fontFamily:"'Sora',sans-serif",display:"flex",alignItems:"center",gap:5,transition:"color 0.15s"}}>
                {panelIcons[p]} {panelLabels[p]}
              </button>
            ))}
          </div>

          {activePanel==="chat"&&(
            <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
              <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"16px 18px",display:"flex",flexDirection:"column",gap:10}}>
                {chatLoading&&<div style={{fontSize:13,color:T.muted,textAlign:"center",padding:24}}>Loading messages…</div>}
                {!chatLoading&&chatMsgs.length===0&&<div style={{fontSize:13,color:T.muted,textAlign:"center",padding:24}}>No messages yet. Say hi to the room.</div>}
                {chatMsgs.map(m=>(
                  <div key={m.id} style={{display:"flex",gap:8,alignItems:"flex-start",flexDirection:m.author==="You"?"row-reverse":"row"}}>
                    <Av letter={m.avatar} size={28} T={T}/>
                    <div style={{maxWidth:"72%"}}>
                      {m.author!=="You"&&<div style={{fontSize:11,color:T.sub,marginBottom:3,textAlign:"left"}}>{m.author}</div>}
                      <div style={{background:m.author==="You"?T.msgUser:T.msgOther,color:m.author==="You"?T.msgUserText:T.msgOtherText,borderRadius:m.author==="You"?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"9px 13px",fontSize:13,lineHeight:1.55}}>
                        {m.text}
                      </div>
                      <div style={{fontSize:10,color:T.muted,marginTop:2,textAlign:m.author==="You"?"right":"left"}}>{m.time}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:8}}>
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Message the room…"
                  style={{flex:1,padding:"10px 14px",borderRadius:10,border:`1.5px solid ${T.inputBorder}`,fontSize:13,fontFamily:"'Sora',sans-serif",background:T.input,color:T.text,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.inputBorder}/>
                <button onClick={sendChat} style={{padding:"10px 16px",borderRadius:10,background:T.text,color:T.bg,border:"none",cursor:"pointer",fontWeight:700,fontSize:13}}>Send</button>
              </div>
            </div>
          )}

          {activePanel==="resources"&&(
            <div style={{flex:1,overflowY:"auto",padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
              <div style={{fontSize:13,color:T.sub}}>Files shared in this room. Click a file to open AI Tutor on it.</div>
              {resources.map(r=>(
                <div key={r.id} onClick={()=>{setActiveRes(r);setPdfText(r._text||"");setActivePanel("ai");setAiMsgs([{role:"assistant",content:`I have **${r.name}** open. What would you like to know?`}]);}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow=T.cardHover} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}
                  style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:14,padding:"14px 16px",cursor:"pointer",display:"flex",gap:12,alignItems:"center",transition:"box-shadow 0.2s"}}>
                  <div style={{width:40,height:48,background:T.accent+"22",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📄</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.name}</div>
                    <div style={{fontSize:11,color:T.sub,marginTop:2}}>Shared by {r.uploader} · {r.size}</div>
                  </div>
                  <div style={{background:T.text,color:T.bg,borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:700,flexShrink:0}}>Ask AI →</div>
                </div>
              ))}
              {resources.length===0&&<div style={{textAlign:"center",padding:32,color:T.muted,fontSize:14}}>No files yet. Upload a PDF to get started.</div>}
            </div>
          )}

          {activePanel==="ai"&&(
            <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
              {activeRes&&(
                <div style={{padding:"8px 16px",background:T.accent+"18",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  <span style={{fontSize:13}}>📄</span>
                  <span style={{fontSize:12,fontWeight:600,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeRes.name}</span>
                  <button onClick={()=>{setActiveRes(null);setPdfText("");}} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:T.sub,fontFamily:"'Sora',sans-serif"}}>Clear ×</button>
                </div>
              )}
              <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
                {["Summarise this","Explain a concept","Quiz me","Key points","Study plan"].map(p=>(
                  <button key={p} onClick={()=>setAiInput(p)} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${T.border}`,background:T.tag,color:T.tagText,fontSize:11,cursor:"pointer",fontFamily:"'Sora',sans-serif"}}>{p}</button>
                ))}
              </div>
              <div ref={aiRef} style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                {aiMsgs.map((m,i)=>(
                  <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",flexDirection:m.role==="user"?"row-reverse":"row"}}>
                    {m.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🤖</div>}
                    <div style={{maxWidth:"80%",background:m.role==="user"?T.msgUser:T.msgOther,color:m.role==="user"?T.msgUserText:T.msgOtherText,borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"10px 13px",fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap"}}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {aiLoading&&<div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🤖</div>
                  <div style={{background:T.msgOther,borderRadius:"14px 14px 14px 4px",padding:"10px 16px",display:"flex",gap:4,alignItems:"center"}}>
                    {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:T.muted,animation:`bounce 1s ease ${i*0.15}s infinite`}}/>)}
                  </div>
                </div>}
              </div>
              <div style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:8,flexShrink:0}}>
                <input value={aiInput} onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendAi()} placeholder="Ask the AI tutor anything…"
                  style={{flex:1,padding:"10px 14px",borderRadius:10,border:`1.5px solid ${T.inputBorder}`,fontSize:13,fontFamily:"'Sora',sans-serif",background:T.input,color:T.text,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.inputBorder}/>
                <button onClick={sendAi} disabled={!aiInput.trim()||aiLoading} style={{padding:"10px 16px",borderRadius:10,background:T.accent,color:T.accentText,border:"none",cursor:"pointer",fontWeight:700,fontSize:13,opacity:(!aiInput.trim()||aiLoading)?0.4:1}}>Send</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Rooms lobby ──────────────────────────────────────────────────────────────
function CreateRoomModal({onClose,onCreate,T,busy}){
  const [name,setName]=useState("");const [subject,setSubject]=useState("");const [cap,setCap]=useState(6);const [priv,setPriv]=useState(false);const [ai,setAi]=useState(false);const [topic,setTopic]=useState("");
  const inp={padding:"10px 12px",borderRadius:10,border:`1px solid ${T.border}`,fontSize:14,color:T.text,background:T.input,fontFamily:"'Sora',sans-serif",outline:"none",width:"100%",boxSizing:"border-box"};
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(4px)"}}>
      <div style={{background:T.surface,borderRadius:22,padding:32,width:"90%",maxWidth:440,display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <h3 style={{margin:0,fontFamily:"'Playfair Display',serif",fontSize:22,color:T.text}}>Create a Room</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button>
        </div>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Room name…" style={inp}/>
        <select value={subject} onChange={e=>setSubject(e.target.value)} style={{...inp,cursor:"pointer"}}>
          <option value="">Select subject…</option>{SUBJECTS.map(s=><option key={s}>{s}</option>)}
        </select>
        <input value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Today's topic (e.g. ACCA P3 Chapter 4)…" style={inp}/>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <label style={{fontSize:13,color:T.sub,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
            <input type="checkbox" checked={priv} onChange={e=>setPriv(e.target.checked)} style={{accentColor:T.accent}}/> Private room 🔒
          </label>
          <label style={{fontSize:13,color:T.sub,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
            <input type="checkbox" checked={ai} onChange={e=>setAi(e.target.checked)} style={{accentColor:T.accent}}/> AI-guided 🤖
          </label>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:13,color:T.sub}}>Max members:</span>
          {[2,4,6,8,10].map(n=><button key={n} onClick={()=>setCap(n)} style={{width:32,height:32,borderRadius:8,border:`1.5px solid ${cap===n?T.accent:T.border}`,background:cap===n?T.accent:T.surface,color:cap===n?T.accentText:T.sub,fontWeight:cap===n?700:400,cursor:"pointer",fontSize:13}}>{n}</button>)}
        </div>
        <Btn onClick={()=>{if(name&&subject)onCreate({name,subject,topic,capacity:cap,isPrivate:priv,aiMode:ai});}} T={T} variant="accent" disabled={busy||!name||!subject}>{busy?"Creating…":"Create Room 🚀"}</Btn>
      </div>
    </div>
  );
}

function RoomsTab({T,showToast,user}){
  const [rooms,setRooms]=useState([]);
  const [loading,setLoading]=useState(true);
  const [creating,setCreating]=useState(false);
  const [activeRoom,setActiveRoom]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [q,setQ]=useState("");

  const load=useCallback(async()=>{
    try{
      const list=await fetchRooms(user);
      setRooms(list);
    }catch(e){
      showToast(e.message||"Couldn't load rooms");
    }finally{
      setLoading(false);
    }
  },[user, showToast]);

  useEffect(()=>{load();},[load]);

  const createRoom=async({name,subject,topic,capacity,isPrivate,aiMode})=>{
    setCreating(true);
    const {data, error}=await supabase.from("rooms").insert({
      name,
      subject,
      topic: topic||"",
      host_id: user.id,
      capacity,
      is_private: isPrivate,
      ai_mode: aiMode,
    }).select("*, host:profiles!host_id(display_name, avatar)").single();
    setCreating(false);
    if(error){showToast(error.message);return;}
    const mapped=mapRoom(data, user);
    setRooms(p=>[mapped,...p]);
    setShowCreate(false);
    setActiveRoom(mapped);
    showToast(`Room "${mapped.name}" created!`);
  };

  const filtered=useMemo(()=>rooms.filter(r=>matchQ([r.name,r.subject,r.topic,r.host],q)),[rooms,q]);
  if(activeRoom) return <StudyRoom room={activeRoom} user={user} T={T} onLeave={()=>{setActiveRoom(null);load();}} showToast={showToast}/>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div><h1 style={{margin:"0 0 5px",fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:700,color:T.text}}>Study Rooms</h1>
        <p style={{margin:0,color:T.sub,fontSize:15}}>Join a room or create your own</p></div>
        <Btn onClick={()=>setShowCreate(true)} T={T} variant="accent">+ Create Room</Btn>
      </div>
      <SearchBar value={q} onChange={setQ} placeholder="Search rooms, subjects, topics…" T={T}/>
      {loading&&<div style={{textAlign:"center",padding:48,color:T.muted,fontSize:14}}>Loading rooms…</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:16}}>
        {filtered.map(r=>(
          <div key={r.id} onMouseEnter={e=>e.currentTarget.style.boxShadow=T.cardHover} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}
            style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:20,display:"flex",flexDirection:"column",gap:12,transition:"box-shadow 0.2s"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                  <span style={{fontWeight:700,fontSize:15,color:T.text,fontFamily:"'Playfair Display',serif"}}>{r.name}</span>
                  {r.isPrivate&&<span style={{fontSize:11}}>🔒</span>}
                  {r.aiMode&&<span style={{background:T.accent+"22",color:T.accent,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700}}>AI</span>}
                </div>
                <div style={{fontSize:12,color:T.sub}}>{r.subject} · Hosted by {r.host}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:700,color:r.members.length>=r.capacity?T.muted:T.accent}}>{r.members.length}/{r.capacity}</div>
                <div style={{fontSize:10,color:T.muted}}>members</div>
              </div>
            </div>
            {r.topic&&<div style={{fontSize:12,color:T.sub,background:T.tag,borderRadius:8,padding:"6px 10px"}}>📖 {r.topic}</div>}
            <div style={{display:"flex",gap:-6}}>
              {r.members.slice(0,5).map((m,i)=>(
                <div key={m.id||i} style={{marginLeft:i>0?-8:0,border:`2px solid ${T.surface}`,borderRadius:"50%",zIndex:r.members.length-i}}>
                  <Av letter={m.avatar} size={26} T={T}/>
                </div>
              ))}
              {r.members.length>5&&<div style={{marginLeft:-8,width:26,height:26,borderRadius:"50%",background:T.tag,border:`2px solid ${T.surface}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:T.sub,fontWeight:700}}>+{r.members.length-5}</div>}
            </div>
            <Btn onClick={()=>{if(r.members.length<r.capacity){setActiveRoom(r);showToast(`Joined ${r.name}!`);}else showToast("Room is full!");}} T={T} variant={r.members.length>=r.capacity?"ghost":"dark"} disabled={r.members.length>=r.capacity}>
              {r.members.length>=r.capacity?"Room Full":"Join Room →"}
            </Btn>
          </div>
        ))}
        {!loading&&filtered.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:48,color:T.muted,fontSize:14}}>No rooms found. Create one!</div>}
      </div>
      {showCreate&&<CreateRoomModal T={T} busy={creating} onClose={()=>setShowCreate(false)} onCreate={createRoom}/>}
    </div>
  );
}

// ─── Partners tab ─────────────────────────────────────────────────────────────
function PartnersTab({T,showToast}){
  const [q,setQ]=useState("");
  const [connected,setConnected]=useState({});
  const filtered=useMemo(()=>MOCK_PARTNERS.filter(p=>matchQ([p.name,p.subject,p.level,p.bio,...p.topics],q)),[q]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div><h1 style={{margin:"0 0 5px",fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:700,color:T.text}}>Find a Study Partner</h1>
      <p style={{margin:0,color:T.sub,fontSize:15}}>Search by subject, course code, paper, or topic</p></div>
      <SearchBar value={q} onChange={setQ} placeholder='Try "ACCA P3", "CFA Level 1", "Calculus 2"…' T={T}/>
      {q&&<div style={{fontSize:13,color:T.muted}}>{filtered.length} result{filtered.length!==1?"s":""} for "{q}"</div>}
      {filtered.length===0?<div style={{textAlign:"center",padding:48,color:T.muted}}>No partners found for "{q}"</div>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:16}}>
          {filtered.map(p=>(
            <div key={p.id} onMouseEnter={e=>e.currentTarget.style.boxShadow=T.cardHover} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}
              style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:20,display:"flex",flexDirection:"column",gap:12,transition:"box-shadow 0.2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{position:"relative"}}><Av letter={p.avatar} size={44} T={T}/>
                  <div style={{position:"absolute",bottom:1,right:1,width:9,height:9,borderRadius:"50%",background:{online:"#4ade80",away:"#facc15",offline:"#666"}[p.status],border:`2px solid ${T.surface}`}}/>
                </div>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15,color:T.text,fontFamily:"'Playfair Display',serif"}}>{hl(p.name,q)}</div><div style={{fontSize:12,color:T.sub}}>{p.level} · {hl(p.subject,q)}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:16,fontWeight:800,color:T.accent}}>🔥{p.streak}</div></div>
              </div>
              <p style={{margin:0,fontSize:13,color:T.sub,lineHeight:1.6}}>{hl(p.bio,q)}</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{p.topics.map(t=><Tag key={t} label={hl(t,q)} T={T}/>)}</div>
              <button onClick={()=>{setConnected(c=>({...c,[p.id]:true}));showToast(`Request sent to ${p.name}!`);}} style={{padding:"10px 0",borderRadius:10,border:connected[p.id]?`1.5px solid #4ade80`:`1.5px solid ${T.text}`,background:connected[p.id]?"#f0fdf4":T.text,color:connected[p.id]?"#166534":T.bg,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"'Sora',sans-serif",transition:"all 0.2s"}}>
                {connected[p.id]?"✓ Connected":"Connect"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Board tab ────────────────────────────────────────────────────────────────
function BoardTab({T,showToast,user}){
  const [posts,setPosts]=useState(MOCK_POSTS);const [q,setQ]=useState("");const [showNew,setShowNew]=useState(false);
  const [likedIds,setLikedIds]=useState({});
  const filtered=useMemo(()=>posts.filter(p=>matchQ([p.subject,p.title,p.body,p.author,...p.topics],q)),[q,posts]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div><h1 style={{margin:"0 0 5px",fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:700,color:T.text}}>Discussion Board</h1>
        <p style={{margin:0,color:T.sub,fontSize:15}}>Ask questions, share knowledge, support each other</p></div>
        <Btn onClick={()=>setShowNew(true)} T={T}>+ Ask a question</Btn>
      </div>
      <SearchBar value={q} onChange={setQ} placeholder='Search — "ACCA", "IFRS 16", "eigenvectors"…' T={T}/>
      {filtered.length===0?<div style={{textAlign:"center",padding:48,color:T.muted}}>No posts found.</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {filtered.map(p=>{
            const liked=!!likedIds[p.id];
            const likes=p.likes+(liked?1:0);
            return <div key={p.id} onMouseEnter={e=>e.currentTarget.style.boxShadow=T.cardHover} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}
              style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:"18px 22px",display:"flex",flexDirection:"column",gap:10,transition:"box-shadow 0.2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}><Av letter={p.avatar} size={32} T={T}/><div><span style={{fontWeight:600,fontSize:13,color:T.text}}>{p.author}</span><span style={{fontSize:12,color:T.muted,marginLeft:8}}>{p.time}</span></div>
                <span style={{marginLeft:"auto",background:T.tag,borderRadius:20,padding:"3px 10px",fontSize:11,color:T.tagText}}>{hl(p.subject,q)}</span></div>
              <div style={{fontWeight:700,fontSize:16,color:T.text,fontFamily:"'Playfair Display',serif",lineHeight:1.35}}>{hl(p.title,q)}</div>
              <p style={{margin:0,fontSize:14,color:T.sub,lineHeight:1.65}}>{hl(p.body,q)}</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{p.topics.map(t=><Tag key={t} label={hl(t,q)} T={T}/>)}</div>
              <div style={{display:"flex",gap:16,marginTop:4}}>
                <button onClick={()=>setLikedIds(s=>({...s,[p.id]:!s[p.id]}))} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:liked?"#ef4444":T.muted,fontWeight:liked?600:400,padding:0,fontFamily:"'Sora',sans-serif"}}>{liked?"♥":"♡"} {likes}</button>
                <button onClick={()=>showToast("Replies coming soon!")} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:T.muted,padding:0,fontFamily:"'Sora',sans-serif"}}>💬 {p.replies}</button>
              </div>
            </div>;
          })}
        </div>
      )}
      {showNew&&<NewPostModal T={T} onClose={()=>setShowNew(false)} onSubmit={({title,body,subject,topics})=>{setPosts(p=>[{id:Date.now(),author:user.name,avatar:user.name[0],subject,topics:topics||[],time:"just now",title,body,replies:0,likes:0},...p]);showToast("Posted!");setShowNew(false);}}/>}
    </div>
  );
}

function NewPostModal({T,onClose,onSubmit}){
  const [title,setTitle]=useState("");const [body,setBody]=useState("");const [subject,setSubject]=useState("");const [ti,setTi]=useState("");const [topics,setTopics]=useState([]);
  const addT=()=>{const t=ti.trim();if(t&&!topics.includes(t))setTopics(p=>[...p,t]);setTi("");};
  const inp={padding:"10px 12px",borderRadius:10,border:`1px solid ${T.border}`,fontSize:14,color:T.text,background:T.input,fontFamily:"'Sora',sans-serif",outline:"none",width:"100%",boxSizing:"border-box"};
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(4px)"}}>
    <div style={{background:T.surface,borderRadius:22,padding:30,width:"90%",maxWidth:440,display:"flex",flexDirection:"column",gap:13}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><h3 style={{margin:0,fontFamily:"'Playfair Display',serif",fontSize:20,color:T.text}}>Ask the board</h3><button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.muted}}>×</button></div>
      <select value={subject} onChange={e=>setSubject(e.target.value)} style={{...inp,cursor:"pointer"}}><option value="">Select subject…</option>{SUBJECTS.map(s=><option key={s}>{s}</option>)}</select>
      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Your question…" style={inp}/>
      <textarea value={body} onChange={e=>setBody(e.target.value)} rows={3} placeholder="More context…" style={{...inp,resize:"vertical"}}/>
      <div style={{display:"flex",gap:8}}><input value={ti} onChange={e=>setTi(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addT()} placeholder="Add tag…" style={{...inp,flex:1}}/><Btn onClick={addT} T={T} variant="ghost">Add</Btn></div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{topics.map(t=><span key={t} style={{background:T.text,color:T.bg,borderRadius:20,padding:"3px 12px",fontSize:12,display:"flex",alignItems:"center",gap:5}}>{t}<button onClick={()=>setTopics(p=>p.filter(x=>x!==t))} style={{background:"none",border:"none",color:T.bg,cursor:"pointer",opacity:.6,padding:0}}>×</button></span>)}</div>
      <Btn onClick={()=>{if(title&&subject)onSubmit({title,body,subject,topics});}} T={T}>Post Question</Btn>
    </div>
  </div>;
}

// ─── Profile tab ──────────────────────────────────────────────────────────────
function ProfileTab({user,setUser,T,showToast,dark,setDark,onSignOut}){
  const [bio,setBio]=useState(user.bio||"Here to learn and grow with great study partners.");const [editing,setEditing]=useState(false);const [saving,setSaving]=useState(false);
  const achievements=[{icon:"🔥",label:"7-day streak",e:true},{icon:"🤝",label:"First connection",e:true},{icon:"📚",label:"Uploaded a resource",e:false},{icon:"💬",label:"First post",e:false},{icon:"⭐",label:"10 connections",e:false},{icon:"🏆",label:"30-day streak",e:false}];
  const saveBio=async()=>{
    setSaving(true);
    const {error}=await supabase.from("profiles").update({bio}).eq("id", user.id);
    setSaving(false);
    if(error){showToast(error.message);return;}
    setUser({...user, bio});
    setEditing(false);
    showToast("Profile updated!");
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:18,maxWidth:580}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
        <h1 style={{margin:0,fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:700,color:T.text}}>My Profile</h1>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setDark(!dark)} style={{background:T.tag,border:`1px solid ${T.border}`,borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,color:T.text,fontFamily:"'Sora',sans-serif",display:"flex",alignItems:"center",gap:6}}>
            {dark?"☀️ Light":"🌙 Dark"} mode
          </button>
          <button onClick={onSignOut} style={{background:T.tag,border:`1px solid ${T.border}`,borderRadius:10,padding:"7px 14px",cursor:"pointer",fontSize:13,color:T.sub,fontFamily:"'Sora',sans-serif"}}>Sign out</button>
        </div>
      </div>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,padding:26,display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}><Av letter={user.avatar||user.name[0]} size={60} T={T}/>
          <div style={{flex:1}}><div style={{fontWeight:700,fontSize:22,color:T.text,fontFamily:"'Playfair Display',serif"}}>{user.name}</div><div style={{fontSize:14,color:T.sub,marginTop:2}}>{user.level}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:26,fontWeight:800,color:T.accent}}>🔥 {user.streak||0}</div><div style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:.5}}>day streak</div></div>
        </div>
        {editing?<div style={{display:"flex",flexDirection:"column",gap:8}}><textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3} style={{padding:"10px 12px",borderRadius:10,border:`1px solid ${T.border}`,fontSize:14,fontFamily:"'Sora',sans-serif",background:T.input,color:T.text,resize:"vertical",outline:"none"}}/><div style={{display:"flex",gap:8}}><Btn onClick={saveBio} T={T} disabled={saving}>{saving?"Saving…":"Save"}</Btn><Btn onClick={()=>setEditing(false)} T={T} variant="ghost">Cancel</Btn></div></div>
        :<div style={{display:"flex",gap:10,alignItems:"flex-start"}}><p style={{flex:1,margin:0,fontSize:14,color:T.sub,lineHeight:1.6}}>{bio}</p><button onClick={()=>setEditing(true)} style={{background:T.tag,border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,color:T.sub,fontFamily:"'Sora',sans-serif",flexShrink:0}}>Edit</button></div>}
        <div><div style={{fontSize:11,color:T.muted,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Studying</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{user.subjects.map(s=><span key={s} style={{background:T.text,color:T.bg,borderRadius:20,padding:"5px 14px",fontSize:13,fontWeight:500}}>{s}</span>)}</div></div>
        {user.topics.length>0&&<div><div style={{fontSize:11,color:T.muted,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Topics & Courses</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{user.topics.map(t=><Tag key={t} label={t} T={T}/>)}</div></div>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        {[["3","Connections"],["1","Resources"],["0","Posts"]].map(([v,l])=>(
          <div key={l} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:16,padding:"18px 14px",textAlign:"center"}}>
            <div style={{fontSize:26,fontWeight:800,color:T.text,fontFamily:"'Playfair Display',serif"}}>{v}</div>
            <div style={{fontSize:12,color:T.muted,marginTop:3}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,padding:22}}>
        <div style={{fontWeight:700,fontSize:16,color:T.text,fontFamily:"'Playfair Display',serif",marginBottom:14}}>Achievements</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
          {achievements.map(a=>(
            <div key={a.label} style={{background:a.e?T.accent+"18":T.tag,border:`1px solid ${a.e?T.accent:T.border}`,borderRadius:12,padding:"12px 10px",textAlign:"center",opacity:a.e?1:0.5}}>
              <div style={{fontSize:22,marginBottom:6}}>{a.icon}</div>
              <div style={{fontSize:11,color:a.e?T.accent:T.muted,fontWeight:a.e?600:400,lineHeight:1.3}}>{a.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]=useState(null);
  const [ready,setReady]=useState(false);
  const [tab,setTab]=useState("rooms");
  const [dark,setDark]=useState(false);
  const [toast,setToast]=useState(null);
  const T=dark?DARK:LIGHT;
  const showToast=useCallback((msg)=>{setToast(msg);setTimeout(()=>setToast(null),3000);},[]);

  useEffect(()=>{
    let mounted=true;
    const applySession=async(session)=>{
      if(!session){
        if(mounted){setUser(null);setReady(true);}
        return;
      }
      const profile=await fetchProfile(session.user.id);
      if(!mounted) return;
      setUser(profile?profileToUser(profile):null);
      setReady(true);
    };
    supabase.auth.getSession().then(({data:{session}})=>applySession(session));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event, session)=>{
      applySession(session);
    });
    return ()=>{mounted=false;subscription.unsubscribe();};
  },[]);

  const signOut=async()=>{
    await supabase.auth.signOut();
    setUser(null);
    setTab("rooms");
  };

  if(!ready) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sora',sans-serif",color:"#777"}}>Loading…</div>;
  if(!user) return <><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet"/><Onboarding onDone={setUser} T={T} showToast={showToast}/></>;

  const tabs=[{key:"rooms",icon:"🚪",label:"Rooms"},{key:"partners",icon:"👥",label:"Partners"},{key:"board",icon:"💬",label:"Board"},{key:"profile",icon:"👤",label:"Profile"}];

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Sora','Helvetica Neue',sans-serif",color:T.text,transition:"background 0.2s,color 0.2s"}}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <header style={{background:T.navBg,borderBottom:`1px solid ${T.border}`,padding:"0 22px",position:"sticky",top:0,zIndex:50,transition:"background 0.2s"}}>
        <div style={{maxWidth:900,margin:"0 auto",display:"flex",alignItems:"center",height:58,gap:8}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:T.text,marginRight:14,flexShrink:0}}>study<span style={{color:T.accent}}>buddy</span></div>
          <nav style={{display:"flex",gap:2,flex:1,overflowX:"auto"}}>
            {tabs.map(t=>(
              <button key={t.key} onClick={()=>setTab(t.key)}
                style={{padding:"6px 14px",borderRadius:8,border:"none",background:tab===t.key?T.text:"transparent",color:tab===t.key?T.bg:T.sub,fontWeight:tab===t.key?600:400,fontSize:13,cursor:"pointer",transition:"all 0.15s",fontFamily:"'Sora',sans-serif",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5}}>
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          <div style={{display:"flex",alignItems:"center",gap:9,flexShrink:0}}>
            <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:600,color:T.text}}>{user.name}</div><div style={{fontSize:10,color:T.muted}}>{user.level}</div></div>
            <Av letter={user.avatar||user.name[0]} size={32} T={T}/>
          </div>
        </div>
      </header>
      <main style={{maxWidth:900,margin:"0 auto",padding:tab==="rooms"?"0":"30px 22px"}}>
        {tab==="rooms"&&<div style={{padding:"30px 22px"}}><RoomsTab T={T} showToast={showToast} user={user}/></div>}
        {tab==="partners"&&<PartnersTab T={T} showToast={showToast}/>}
        {tab==="board"&&<BoardTab T={T} showToast={showToast} user={user}/>}
        {tab==="profile"&&<ProfileTab user={user} setUser={setUser} T={T} showToast={showToast} dark={dark} setDark={setDark} onSignOut={signOut}/>}
      </main>
      {toast&&<div style={{position:"fixed",bottom:26,left:"50%",transform:"translateX(-50%)",background:T.text,color:T.bg,padding:"11px 24px",borderRadius:28,fontSize:13,fontWeight:500,zIndex:999,boxShadow:"0 4px 20px rgba(0,0,0,0.25)",animation:"toastIn 0.25s ease",whiteSpace:"nowrap"}}>{toast}</div>}
      <style>{`*{box-sizing:border-box;}body{margin:0;}@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}@keyframes bounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-4px);}}::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:${T.border};border-radius:10px;}`}</style>
    </div>
  );
}
