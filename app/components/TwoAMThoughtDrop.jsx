"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";

// ─── Config ────────────────────────────────────────────────────────────────
const NEARBY_RADIUS_KM = 50; 
// city-wide. Tighten to 5–10 once you have users.
// ─── Drop limit helpers ────────────────────────────────────────────────────
const FREE_DAILY_LIMIT = 1;
const CATEGORIES = [
  { id: "latenight", emoji: "🌙", label: "Late Night", color: "#8b7cf8" },
  { id: "heartbreak", emoji: "💔", label: "Heartbreak", color: "#ff6b8a" },
  { id: "funny", emoji: "😂", label: "Funny", color: "#ffd700" },
  { id: "existential", emoji: "🌀", label: "Existential", color: "#64c8b4" },
  { id: "grateful", emoji: "✨", label: "Grateful", color: "#ffb43c" },
];
function getTodayKey() {
  return `2am_drops_${new Date().toISOString().slice(0, 10)}`;
}

function getDropCount() {
  const count = localStorage.getItem(getTodayKey());
  return count ? parseInt(count) : 0;
}

function incrementDropCount() {
  const key = getTodayKey();
  const count = getDropCount();
  localStorage.setItem(key, count + 1);
}

function isPremium() {
  return localStorage.getItem("2am_premium") === "true";
}

function hasReachedLimit() {
  if (isPremium()) return false;
  return getDropCount() >= FREE_DAILY_LIMIT;
}
const GRID_LINES_H = 8;
const GRID_LINES_V = 12;
const MAX_CHARS = 140;

const CITY_LIGHTS = Array.from({ length: 180 }, (_, i) => ({
  x: ((i * 37 + 13) % 97) + 1.5,
  y: ((i * 53 + 7) % 93) + 2,
  size: (i % 5 === 0) ? 2.5 : (i % 3 === 0) ? 1.8 : 1.2,
  opacity: 0.08 + (i % 7) * 0.03,
  color: i % 11 === 0 ? "#f0c060" : i % 7 === 0 ? "#80c0ff" : "#fff",
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function timeRemaining(createdAt) {
  const rem = new Date(createdAt).getTime() + 86400000 - Date.now();
  if (rem <= 0) return "expiring...";
  return `${Math.floor(rem / 3600000)}h ${Math.floor((rem % 3600000) / 60000)}m left`;
}

// Haversine distance in km
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Project a real lat/lng onto the 0-100 visual canvas.
 * The user's own position maps to (50, 50) — always centred.
 * radiusKm fills 40 units of the 100-unit canvas from centre.
 */
function latLngToXY(lat, lng, cLat, cLng, radiusKm) {
  const kmPerLat = 111;
  const kmPerLng = 111 * Math.cos((cLat * Math.PI) / 180);
  const dx = (lng - cLng) * kmPerLng;
  const dy = (lat - cLat) * kmPerLat;
  const scale = 40 / radiusKm;
  return {
    x: Math.min(95, Math.max(5, 50 + dx * scale)),
    y: Math.min(95, Math.max(5, 50 - dy * scale)), // y-axis inverted
  };
}

function rowToPin(row, myId, uLat, uLng) {
  const { x, y } =
    uLat != null && row.lat != null
      ? latLngToXY(row.lat, row.lng, uLat, uLng, NEARBY_RADIUS_KM)
      : { x: row.x ?? 50, y: row.y ?? 50 };
  return {
    id: row.id,
    x, y,
    lat: row.lat,
    lng: row.lng,
    text: row.text,
    echoes: row.echoes,
    category: row.category,
    createdAt: row.created_at,
    time: timeAgo(row.created_at),
    isYours: row.id === myId,
  };
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function TwoAMThoughtDrop() {
  const [thoughts, setThoughts]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [activePin, setActivePin]         = useState(null);
  const [showDrop, setShowDrop]           = useState(false);
  const [newThought, setNewThought]       = useState("");
  const [dropping, setDropping]           = useState(false);
  const [dropped, setDropped]             = useState(false);
  const [echoed, setEchoed]               = useState(new Set());
  const [myDropId, setMyDropId]           = useState(null);
  const [mapOffset, setMapOffset]         = useState({ x: 0, y: 0 });
  const [dragging, setDragging]           = useState(false);
  const [dragStart, setDragStart]         = useState(null);
  const [pulsingPins, setPulsingPins]     = useState(new Set());
  const [viewMode, setViewMode]           = useState("map");
  const [error, setError]                 = useState(null);
  const [userLat, setUserLat]             = useState(null);
  const [userLng, setUserLng]             = useState(null);
  const [locationStatus, setLocationStatus] = useState("pending");
  const [showPaywall, setShowPaywall] = useState(false);
const [dropsRemaining, setDropsRemaining] = useState(FREE_DAILY_LIMIT);
const [selectedCategory, setSelectedCategory] = useState("latenight");
  const textRef = useRef();

  // ── 1. Ask for location on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      fetchThoughts(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLat(coords.latitude);
        setUserLng(coords.longitude);
        setLocationStatus("granted");
        fetchThoughts(coords.latitude, coords.longitude);
      },
      () => {
        setLocationStatus("denied");
        fetchThoughts(null, null);
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  }, []);

  // ── 2. Fetch thoughts ─────────────────────────────────────────────────────
  async function fetchThoughts(lat, lng) {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("thoughts")
        .select("*")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      if (e) throw e;

      const filtered = lat != null
        ? data.filter(r => r.lat == null || distanceKm(lat, lng, r.lat, r.lng) <= NEARBY_RADIUS_KM)
        : data;

      setThoughts(filtered.map(r => rowToPin(r, null, lat, lng)));
    } catch (err) {
      setError("Couldn't load thoughts. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  // ── 3. Real-time subscription ─────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel("thoughts-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "thoughts" }, ({ new: row }) => {
        if (userLat == null || row.lat == null || distanceKm(userLat, userLng, row.lat, row.lng) <= NEARBY_RADIUS_KM) {
          setThoughts(p => [rowToPin(row, myDropId, userLat, userLng), ...p]);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "thoughts" }, ({ new: row }) => {
        setThoughts(p => p.map(t => t.id === row.id ? { ...t, echoes: row.echoes } : t));
        setActivePin(p => p?.id === row.id ? { ...p, echoes: row.echoes } : p);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [myDropId, userLat, userLng]);

  // ── 4. Pulse pins & refresh timestamps ───────────────────────────────────
  useEffect(() => {
    if (!thoughts.length) return;
    const iv = setInterval(() => {
      const pin = thoughts[Math.floor(Math.random() * thoughts.length)];
      if (!pin) return;
      setPulsingPins(p => new Set([...p, pin.id]));
      setTimeout(() => setPulsingPins(p => { const n = new Set(p); n.delete(pin.id); return n; }), 1500);
    }, 2200);
    return () => clearInterval(iv);
  }, [thoughts]);

  useEffect(() => {
    const iv = setInterval(() => setThoughts(p => p.map(t => ({ ...t, time: timeAgo(t.createdAt) }))), 60000);
    return () => clearInterval(iv);
  }, []);

  // ── 5. Drop a thought ─────────────────────────────────────────────────────
  async function handleDrop() {
    if (!newThought.trim() || dropping) return;
    if (hasReachedLimit()) {
      setShowDrop(false);
      setShowPaywall(true);
      return;
    }
    setDropping(true);
    setError(null);

    const lat = userLat;
    const lng = userLng;
    const { x, y } = lat != null
      ? latLngToXY(lat, lng, userLat, userLng, NEARBY_RADIUS_KM)
      : { x: 30 + Math.random() * 40, y: 30 + Math.random() * 40 };

    try {
     const { data, error: insertError } = await supabase
        .from("thoughts")
        .insert([{ text: newThought.trim(), x, y, lat, lng, echoes: 0, category: selectedCategory }])
        .select()
        .single();
      if (e) throw e;

      const pin = rowToPin(data, data.id, userLat, userLng);
      setMyDropId(data.id);
      setThoughts(p => [{ ...pin, isYours: true }, ...p]);
      setNewThought("");
      setShowDrop(false);
      setDropped(true);
      incrementDropCount();
setDropsRemaining(Math.max(0, FREE_DAILY_LIMIT - getDropCount()));
      setTimeout(() => setDropped(false), 4000);
    } catch (err) {
  setError("Couldn't drop your thought. Try again.");
  console.error("Drop error:", err);
} finally {
      setDropping(false);
    }
  }

  // ── 6. Echo ───────────────────────────────────────────────────────────────
  async function handleEcho(id) {
    if (echoed.has(id)) return;
    setEchoed(e => new Set([...e, id]));
    setThoughts(p => p.map(t => t.id === id ? { ...t, echoes: t.echoes + 1 } : t));
    setActivePin(p => p?.id === id ? { ...p, echoes: p.echoes + 1 } : p);
    try {
      const { error: e } = await supabase.rpc("increment_echoes", { thought_id: id });
      if (e) throw e;
   } catch {
      setEchoed(prev => { const n = new Set(prev); n.delete(id); return n; });
      setThoughts(p => p.map(t => t.id === id ? { ...t, echoes: t.echoes - 1 } : t));
    }

  // ── Map drag ──────────────────────────────────────────────────────────────
  const onMouseDown = e => { if (e.target.closest(".pin")) return; setDragging(true); setDragStart({ x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y }); };
  const onMouseMove = e => { if (!dragging) return; setMapOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const onMouseUp   = () => setDragging(false);

  const locBadge = {
    pending:     { text: "locating...",                    color: "#3a3828" },
    granted:     { text: "📍 pinned to your location",    color: "#64c8b4" },
    denied:      { text: "📍 location off · showing all", color: "#ffb43c" },
    unavailable: { text: "location unavailable",           color: "#ff8070" },
  }[locationStatus];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ width:"100%", height:"100vh", background:"#050810", fontFamily:"'DM Mono','Courier New',monospace", color:"#e8dcc8", overflow:"hidden", position:"relative", userSelect:"none" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Instrument+Serif:ital@0;1&display=swap');
        *{box-sizing:border-box}
        .pin-dot{position:absolute;transform:translate(-50%,-50%);cursor:pointer;transition:transform .15s;z-index:10}
        .pin-dot:hover{transform:translate(-50%,-50%) scale(1.4)}
        .pin-glow{animation:pinGlow 2s ease-in-out infinite}
        @keyframes pinGlow{0%,100%{box-shadow:0 0 6px 2px rgba(255,180,60,.4)}50%{box-shadow:0 0 14px 5px rgba(255,180,60,.7)}}
        .pin-pulse{animation:pinPulse 1.5s ease-out forwards}
        @keyframes pinPulse{0%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(2.2);opacity:.5}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}
        .yours-pin{animation:yoursPulse 3s ease-in-out infinite}
        @keyframes yoursPulse{0%,100%{box-shadow:0 0 10px 4px rgba(100,200,180,.5)}50%{box-shadow:0 0 20px 8px rgba(100,200,180,.8)}}
        .you-dot{position:absolute;transform:translate(-50%,-50%);z-index:15;pointer-events:none}
        .you-pulse{animation:youPulse 2s ease-in-out infinite}
        @keyframes youPulse{0%,100%{box-shadow:0 0 0 0 rgba(100,200,180,.5)}50%{box-shadow:0 0 0 12px rgba(100,200,180,0)}}
        .thought-card{animation:cardIn .35s cubic-bezier(.34,1.56,.64,1) forwards;opacity:0}
        @keyframes cardIn{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        .drop-panel{animation:panelUp .4s cubic-bezier(.34,1.56,.64,1) forwards}
        @keyframes panelUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
        .dropped-toast{animation:toastIn .4s ease forwards,toastOut .4s ease 3.2s forwards}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes toastOut{from{opacity:1}to{opacity:0}}
        .feed-item{animation:feedIn .3s ease forwards;opacity:0}
        @keyframes feedIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
        .echo-btn:hover{background:rgba(255,180,60,.15)!important}
        .echo-btn:active{transform:scale(.92)}
        textarea:focus{outline:none}
        textarea::placeholder{color:#3a3828}
        .ripple{position:absolute;border-radius:50%;border:1px solid rgba(255,180,60,.3);animation:rippleOut 2s ease-out infinite;pointer-events:none;transform:translate(-50%,-50%)}
        @keyframes rippleOut{0%{width:10px;height:10px;opacity:.6}100%{width:50px;height:50px;opacity:0}}
        .spin{animation:spin 1s linear infinite}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
      `}</style>

      {/* MAP */}
      <div style={{ position:"absolute", inset:0, cursor:dragging?"grabbing":"grab", overflow:"hidden" }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <div style={{ position:"absolute", width:"140%", height:"140%", top:"-20%", left:"-20%", transform:`translate(${mapOffset.x*.3}px,${mapOffset.y*.3}px)`, transition:dragging?"none":"transform .1s" }}>
          <div style={{ position:"absolute", inset:0, background:"#050810" }} />
          {Array.from({length:GRID_LINES_V}).map((_,i) => <div key={`v${i}`} style={{ position:"absolute", left:`${(i/GRID_LINES_V)*100}%`, top:0, bottom:0, width:i%3===0?"1px":"0.5px", background:i%3===0?"rgba(255,255,255,.04)":"rgba(255,255,255,.02)" }} />)}
          {Array.from({length:GRID_LINES_H}).map((_,i) => <div key={`h${i}`} style={{ position:"absolute", top:`${(i/GRID_LINES_H)*100}%`, left:0, right:0, height:i%2===0?"1px":"0.5px", background:i%2===0?"rgba(255,255,255,.04)":"rgba(255,255,255,.02)" }} />)}
          <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
            <div style={{ position:"absolute", width:"200%", height:"0.5px", background:"rgba(255,255,255,.03)", top:"38%", left:"-50%", transform:"rotate(-12deg)" }} />
            <div style={{ position:"absolute", width:"200%", height:"0.5px", background:"rgba(255,255,255,.025)", top:"62%", left:"-50%", transform:"rotate(8deg)" }} />
          </div>
          {CITY_LIGHTS.map((l,i) => <div key={i} style={{ position:"absolute", left:`${l.x}%`, top:`${l.y}%`, width:`${l.size}px`, height:`${l.size}px`, borderRadius:"50%", background:l.color, opacity:l.opacity, pointerEvents:"none" }} />)}
          {[{x:25,y:35,s:180,c:"rgba(255,140,60,.025)"},{x:65,y:55,s:220,c:"rgba(100,160,255,.02)"},{x:45,y:75,s:150,c:"rgba(255,100,120,.02)"}].map((z,i) => <div key={i} style={{ position:"absolute", left:`${z.x}%`, top:`${z.y}%`, width:`${z.s}px`, height:`${z.s}px`, borderRadius:"50%", background:`radial-gradient(circle,${z.c} 0%,transparent 70%)`, transform:"translate(-50%,-50%)", pointerEvents:"none" }} />)}

          {/* YOU — always at centre when location is on */}
          {locationStatus === "granted" && (
            <div className="you-dot" style={{ left:"50%", top:"50%" }}>
              <div style={{ position:"absolute", width:"28px", height:"28px", borderRadius:"50%", border:"1px solid rgba(100,200,180,.2)", top:"50%", left:"50%", transform:"translate(-50%,-50%)" }} />
              <div className="you-pulse" style={{ width:"10px", height:"10px", borderRadius:"50%", background:"#64c8b4", position:"relative" }} />
              <div style={{ position:"absolute", top:"16px", left:"50%", transform:"translateX(-50%)", fontSize:"8px", color:"#64c8b4", letterSpacing:"1px", whiteSpace:"nowrap", opacity:.7 }}>you</div>
            </div>
          )}

          {/* Thought pins */}
          {thoughts.map(pin => (
            <div key={pin.id} className={`pin-dot pin ${pulsingPins.has(pin.id)?"pin-pulse":""}`} style={{ left:`${pin.x}%`, top:`${pin.y}%` }} onClick={e => { e.stopPropagation(); setActivePin(pin); }}>
              {(pin.echoes > 20 || pin.isYours) && <div className="ripple" style={{ top:"50%", left:"50%", animationDelay:`${(String(pin.id).charCodeAt(0)%5)*.4}s` }} />}
              <div className={pin.isYours?"yours-pin":"pin-glow"} style={{ width:pin.echoes>50?"12px":pin.echoes>20?"10px":"8px", height:pin.echoes>50?"12px":pin.echoes>20?"10px":"8px", borderRadius:"50%", background:pin.isYours?"#64c8b4":pin.echoes>50?"#ffb43c":pin.echoes>20?"#ff9a20":"#e87828", position:"relative", zIndex:2 }} />
            </div>
          ))}
        </div>
      </div>

      {/* HEADER */}
      <div style={{ position:"absolute", top:0, left:0, right:0, padding:"20px 24px 16px", background:"linear-gradient(to bottom,rgba(5,8,16,.95) 0%,transparent 100%)", zIndex:40, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontFamily:"'Instrument Serif',serif", fontSize:"22px", color:"#e8dcc8", lineHeight:1 }}>2<span style={{ color:"#ffb43c" }}>AM</span></div>
          <div style={{ fontSize:"9px", letterSpacing:"3px", color:"#3a3828", textTransform:"uppercase", marginTop:"2px" }}>thought drop</div>
        </div>
        <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
          <div style={{ display:"flex", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.07)", borderRadius:"20px", padding:"3px" }}>
            {[{id:"map",icon:"◉"},{id:"feed",icon:"≡"}].map(v => <button key={v.id} onClick={() => setViewMode(v.id)} style={{ padding:"5px 12px", borderRadius:"16px", border:"none", cursor:"pointer", background:viewMode===v.id?"rgba(255,180,60,.15)":"transparent", color:viewMode===v.id?"#ffb43c":"#3a3828", fontSize:"14px", transition:"all .15s" }}>{v.icon}</button>)}
          </div>
          <div style={{ background:"rgba(255,180,60,.08)", border:"1px solid rgba(255,180,60,.15)", borderRadius:"20px", padding:"5px 12px", fontSize:"11px", color:"#ffb43c", letterSpacing:"1px" }}>{loading?"...": `● ${thoughts.length} near you`}</div>
        </div>
      </div>

      {/* LOCATION PILL */}
      <div style={{ position:"absolute", top:"68px", left:"50%", transform:"translateX(-50%)", zIndex:20, pointerEvents:"none" }}>
        <div style={{ background:"rgba(5,8,16,.85)", border:`1px solid ${locBadge.color}30`, borderRadius:"20px", padding:"4px 12px", fontSize:"10px", color:locBadge.color, letterSpacing:"1px", whiteSpace:"nowrap" }}>{locBadge.text}</div>
      </div>

      {/* LOADING */}
      {loading && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", zIndex:25, pointerEvents:"none" }}><div className="spin" style={{ width:"20px", height:"20px", border:"2px solid rgba(255,180,60,.2)", borderTopColor:"#ffb43c", borderRadius:"50%" }} /></div>}

      {/* ERROR */}
      {error && <div style={{ position:"absolute", top:"104px", left:"50%", transform:"translateX(-50%)", background:"rgba(255,80,60,.12)", border:"1px solid rgba(255,80,60,.25)", borderRadius:"12px", padding:"8px 16px", fontSize:"11px", color:"#ff8070", letterSpacing:"1px", zIndex:30, whiteSpace:"nowrap" }}>{error}</div>}

      {/* FEED VIEW */}
      {viewMode === "feed" && (
        <div style={{ position:"absolute", inset:0, zIndex:30, background:"rgba(5,8,16,.97)", overflowY:"auto", padding:"80px 0 120px" }}>
          <div style={{ maxWidth:"480px", margin:"0 auto", padding:"0 20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
              <div style={{ fontSize:"10px", letterSpacing:"3px", color:"#3a3828", textTransform:"uppercase" }}>Nearby · Last 24h</div>
              <div style={{ fontSize:"10px", color:locBadge.color, letterSpacing:"1px" }}>{locBadge.text}</div>
            </div>
            {loading && <div style={{ color:"#3a3828", fontSize:"12px", letterSpacing:"2px" }}>loading thoughts...</div>}
            {!loading && thoughts.length === 0 && <div style={{ color:"#3a3828", fontSize:"14px", fontFamily:"'Instrument Serif',serif", fontStyle:"italic" }}>No thoughts dropped nearby yet. Be the first.</div>}
            {thoughts.map((pin, i) => (
              <div key={pin.id} className="feed-item" style={{ animationDelay:`${i*.04}s`, borderBottom:"1px solid rgba(255,255,255,.04)", padding:"20px 0" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"10px" }}>
                  <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
                    <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:pin.isYours?"#64c8b4":pin.echoes>30?"#ffb43c":"#e87828", flexShrink:0 }} />
                    <span style={{ fontSize:"10px", color:"#3a3828", letterSpacing:"1px" }}>{pin.time}</span>
                    {pin.isYours && <span style={{ fontSize:"9px", color:"#64c8b4", letterSpacing:"2px" }}>YOU</span>}
                  </div>
                  <span style={{ fontSize:"9px", color:"#2a2818", letterSpacing:"1px" }}>{timeRemaining(pin.createdAt)}</span>
                </div>
                <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:"18px", lineHeight:1.55, color:"#c8bca8", margin:"0 0 12px 16px", fontStyle:"italic" }}>{pin.text}</p>
                <div style={{ marginLeft:"16px" }}>
                  <button className="echo-btn" onClick={() => handleEcho(pin.id)} style={{ display:"flex", alignItems:"center", gap:"6px", background:echoed.has(pin.id)?"rgba(255,180,60,.1)":"transparent", border:`1px solid ${echoed.has(pin.id)?"rgba(255,180,60,.3)":"rgba(255,255,255,.06)"}`, borderRadius:"20px", padding:"5px 12px", color:echoed.has(pin.id)?"#ffb43c":"#3a3828", fontSize:"11px", cursor:"pointer", letterSpacing:"1px", transition:"all .15s" }}>
                    <span style={{ fontSize:"13px" }}>◎</span>
                    <span>{echoed.has(pin.id)?"echoed":"echo"}</span>
                    <span style={{ opacity:.5 }}>{pin.echoes}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVE PIN CARD */}
      {activePin && !showDrop && (
        <div className="thought-card" style={{ position:"absolute", bottom:"100px", left:"50%", transform:"translateX(-50%)", width:"min(88vw,360px)", background:"rgba(10,12,20,.96)", border:"1px solid rgba(255,180,60,.15)", borderRadius:"20px", padding:"24px", zIndex:40, backdropFilter:"blur(20px)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
            <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
              <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:activePin.isYours?"#64c8b4":"#ffb43c" }} />
              <span style={{ fontSize:"10px", color:"#3a3828", letterSpacing:"1px" }}>{activePin.time}</span>
              {activePin.isYours && <span style={{ fontSize:"9px", color:"#64c8b4", letterSpacing:"2px" }}>YOUR DROP</span>}
            </div>
            <button onClick={() => setActivePin(null)} style={{ background:"none", border:"none", color:"#3a3828", cursor:"pointer", fontSize:"18px", lineHeight:1 }}>×</button>
          </div>
          <p style={{ fontFamily:"'Instrument Serif',serif", fontSize:"20px", lineHeight:1.6, color:"#e8dcc8", margin:"0 0 20px", fontStyle:"italic" }}>"{activePin.text}"</p>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <button className="echo-btn" onClick={() => handleEcho(activePin.id)} style={{ display:"flex", alignItems:"center", gap:"8px", background:echoed.has(activePin.id)?"rgba(255,180,60,.12)":"rgba(255,255,255,.03)", border:`1px solid ${echoed.has(activePin.id)?"rgba(255,180,60,.35)":"rgba(255,255,255,.08)"}`, borderRadius:"20px", padding:"8px 16px", color:echoed.has(activePin.id)?"#ffb43c":"#5a5840", fontSize:"12px", cursor:"pointer", letterSpacing:"1px", transition:"all .15s" }}>
              <span style={{ fontSize:"16px" }}>◎</span>
              <span>{echoed.has(activePin.id)?"echoed":"I feel this"}</span>
              <span style={{ fontSize:"13px", opacity:.6 }}>{activePin.echoes}</span>
            </button>
            <div style={{ fontSize:"10px", color:"#2a2818", letterSpacing:"1px" }}>{timeRemaining(activePin.createdAt)}</div>
          </div>
        </div>
      )}

      {/* DROP PANEL */}
      {showDrop && (
        <div className="drop-panel" style={{ position:"absolute", bottom:0, left:0, right:0, background:"rgba(8,10,18,.98)", borderTop:"1px solid rgba(255,180,60,.12)", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", zIndex:50, backdropFilter:"blur(30px)" }} onClick={e => e.stopPropagation()}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
            <div>
              <div style={{ fontFamily:"'Instrument Serif',serif", fontSize:"20px", color:"#e8dcc8" }}>Drop a thought.</div>
              <div style={{ fontSize:"10px", color:locationStatus==="granted"?"#64c8b4":"#3a3828", letterSpacing:"2px", textTransform:"uppercase", marginTop:"2px" }}>
                {locationStatus === "granted" ? "📍 pinned to your spot · " : ""}anonymous · vanishes in 24h
              </div>
            </div>
            <button onClick={() => { setShowDrop(false); setNewThought(""); }} style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.07)", borderRadius:"50%", width:"32px", height:"32px", color:"#5a5840", cursor:"pointer", fontSize:"16px" }}>×</button>
          </div><div style={{ display:"flex", gap:"8px", marginBottom:"16px", flexWrap:"wrap" }}>
  {CATEGORIES.map(cat => (
    <button
      key={cat.id}
      onClick={() => setSelectedCategory(cat.id)}
      style={{
        padding:"6px 12px",
        borderRadius:"20px",
        border:`1px solid ${selectedCategory === cat.id ? cat.color : "rgba(255,255,255,0.08)"}`,
        background: selectedCategory === cat.id ? `${cat.color}22` : "transparent",
        color: selectedCategory === cat.id ? cat.color : "#3a3828",
        fontFamily:"'DM Mono',monospace",
        fontSize:"11px",
        letterSpacing:"1px",
        cursor:"pointer",
        transition:"all 0.15s",
        display:"flex",
        alignItems:"center",
        gap:"4px",
      }}
    >
      <span>{cat.emoji}</span>
      <span>{cat.label}</span>
    </button>
  ))}
</div>
          <textarea ref={textRef} autoFocus value={newThought} onChange={e => e.target.value.length <= MAX_CHARS && setNewThought(e.target.value)} placeholder="what's on your mind at this hour..." style={{ width:"100%", background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)", borderRadius:"14px", color:"#e8dcc8", fontFamily:"'Instrument Serif',serif", fontStyle:"italic", fontSize:"18px", padding:"16px", resize:"none", minHeight:"100px", lineHeight:1.6 }} />
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:"14px" }}>
            <span style={{ fontSize:"11px", color:newThought.length>120?"#ff6060":"#2a2818", letterSpacing:"1px" }}>{MAX_CHARS - newThought.length}</span>
            <button onClick={handleDrop} disabled={!newThought.trim()||dropping} style={{ padding:"12px 28px", background:!newThought.trim()||dropping?"rgba(255,180,60,.1)":"rgba(255,180,60,.85)", border:"1px solid rgba(255,180,60,.3)", borderRadius:"20px", color:!newThought.trim()||dropping?"#5a5030":"#0a0800", fontFamily:"'DM Mono',monospace", fontSize:"12px", fontWeight:500, letterSpacing:"2px", textTransform:"uppercase", cursor:!newThought.trim()||dropping?"not-allowed":"pointer", transition:"all .2s" }}>
              {dropping ? "dropping..." : "drop it"}
            </button>
          </div>
        </div>
      )}
{/* PAYWALL */}
{showPaywall && (
  <div style={{ position:"absolute", inset:0, zIndex:60, background:"rgba(5,8,16,0.97)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px" }}>
    <div style={{ maxWidth:"360px", width:"100%", textAlign:"center" }}>
      <div style={{ fontSize:"48px", marginBottom:"16px" }}>🌙</div>
      <div style={{ fontFamily:"'Instrument Serif',serif", fontSize:"32px", fontWeight:900, color:"#e8dcc8", lineHeight:1.2, marginBottom:"8px" }}>
        You've dropped<br/>
        <span style={{ color:"#ffb43c", fontStyle:"italic" }}>your thought.</span>
      </div>
      <p style={{ fontFamily:"'DM Mono',monospace", fontSize:"12px", color:"#3a3828", letterSpacing:"2px", marginBottom:"40px", lineHeight:1.8 }}>
        FREE USERS GET 1 DROP PER DAY.<br/>
        COME BACK TOMORROW OR GO PREMIUM.
      </p>

      {/* Premium card */}
      <div style={{ background:"rgba(255,180,60,0.06)", border:"1px solid rgba(255,180,60,0.2)", borderRadius:"20px", padding:"28px", marginBottom:"16px" }}>
        <div style={{ fontFamily:"'Instrument Serif',serif", fontSize:"22px", color:"#e8dcc8", marginBottom:"4px" }}>2AM Premium</div>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"11px", color:"#3a3828", letterSpacing:"2px", marginBottom:"20px" }}>$3.99 / MONTH</div>
        {[
          "Unlimited drops every day",
          "See thoughts from the whole city",
          "Your pins glow gold",
        ].map((f, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"10px", textAlign:"left" }}>
            <span style={{ color:"#ffb43c", fontSize:"14px" }}>✦</span>
            <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"12px", color:"#9a8878", letterSpacing:"1px" }}>{f}</span>
          </div>
        ))}
        <button
        onClick={async () => {
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    console.error("Checkout error:", err);
  }
}}
          style={{ width:"100%", marginTop:"16px", padding:"14px", background:"rgba(255,180,60,0.9)", border:"none", borderRadius:"12px", color:"#0a0800", fontFamily:"'DM Mono',monospace", fontSize:"12px", fontWeight:700, letterSpacing:"2px", textTransform:"uppercase", cursor:"pointer" }}
        >
          Go Premium — $3.99/mo
        </button>
      </div>

      {/* Come back tomorrow */}
      <button
        onClick={async () => {
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    console.error("Checkout error:", err);
  }
}}
        style={{ background:"none", border:"none", color:"#3a3828", fontFamily:"'DM Mono',monospace", fontSize:"11px", letterSpacing:"2px", cursor:"pointer", textTransform:"uppercase" }}
      >
        Come back tomorrow →
      </button>
    </div>
  </div>
)}
      {/* TOAST */}
      {dropped && (
        <div className="dropped-toast" style={{ position:"absolute", bottom:"120px", left:"50%", background:"rgba(100,200,180,.1)", border:"1px solid rgba(100,200,180,.25)", borderRadius:"20px", padding:"10px 20px", fontSize:"12px", color:"#64c8b4", letterSpacing:"2px", zIndex:60, whiteSpace:"nowrap", textTransform:"uppercase" }}>
          ✦ dropped{locationStatus==="granted"?" · pinned to your spot":""} · vanishes in 24h
        </div>
      )}

      {/* BOTTOM BAR */}
      {!showDrop && (
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"16px 24px 28px", background:"linear-gradient(to top,rgba(5,8,16,.98) 0%,transparent 100%)", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:20 }}>
          <div>
            <div style={{ fontSize:"10px", color:"#3a3828", letterSpacing:"2px", textTransform:"uppercase" }}>your city</div>
            <div style={{ fontSize:"11px", color:"#5a5840", marginTop:"2px", letterSpacing:"1px" }}>{loading?"...":`${thoughts.filter(t=>!t.isYours).length} strangers awake`}</div>
          </div>
          <button onClick={() => { setShowDrop(true); setActivePin(null); }} style={{ width:"56px", height:"56px", borderRadius:"50%", background:"rgba(255,180,60,.9)", border:"none", color:"#0a0800", fontSize:"22px", cursor:"pointer", boxShadow:"0 0 30px rgba(255,180,60,.4),0 4px 20px rgba(0,0,0,.5)", transition:"all .2s", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>+</button>
          <div style={{ textAlign:"right" }}>
            <div style={{ display:"flex", gap:"10px", justifyContent:"flex-end", alignItems:"center" }}>
              {[{c:"#e87828",l:"quiet"},{c:"#ffb43c",s:"8px",l:"resonating"}].map((d,i) => (
                <div key={i} style={{ display:"flex", gap:"4px", alignItems:"center" }}>
                  <div style={{ width:d.s||"6px", height:d.s||"6px", borderRadius:"50%", background:d.c }} />
                  <span style={{ fontSize:"9px", color:"#2a2818", letterSpacing:"1px" }}>{d.l}</span>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:"4px", alignItems:"center", justifyContent:"flex-end", marginTop:"4px" }}>
              <div style={{ width:"7px", height:"7px", borderRadius:"50%", background:"#64c8b4" }} />
              <span style={{ fontSize:"9px", color:"#2a2818", letterSpacing:"1px" }}>yours</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
