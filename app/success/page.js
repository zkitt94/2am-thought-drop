"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Success() {
  const router = useRouter();

  useEffect(() => {
    localStorage.setItem("2am_premium", "true");
    setTimeout(() => router.push("/"), 3000);
  }, []);

  return (
    <div style={{ minHeight:"100vh", background:"#050810", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:"16px", fontFamily:"'DM Mono',monospace" }}>
      <div style={{ fontSize:"48px" }}>🌙</div>
      <div style={{ color:"#ffb43c", fontSize:"18px", letterSpacing:"2px" }}>WELCOME TO PREMIUM</div>
      <div style={{ color:"#3a3828", fontSize:"12px", letterSpacing:"2px" }}>taking you back...</div>
    </div>
  );
}