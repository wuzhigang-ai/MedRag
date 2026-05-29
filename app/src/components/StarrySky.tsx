import { useEffect, useRef, useState } from "react";

interface StarData {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  color: string;
}

interface ShootingStarData {
  id: number;
  startX: number;
  startY: number;
  delay: number;
  duration: number;
}

export default function StarrySky() {
  const [stars, setStars] = useState<StarData[]>([]);
  const [shooters, setShooters] = useState<ShootingStarData[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Generate stars
    const starList: StarData[] = [];
    const colors = ["#ffffff", "#a8d8ff", "#7eb8ff", "#00C4B4", "#a0c4ff"];
    for (let i = 0; i < 180; i++) {
      starList.push({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 70, // keep stars mostly in upper 70%
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.6 + 0.2,
        duration: Math.random() * 3 + 2,
        delay: Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    setStars(starList);

    // Generate shooting stars
    const shooterList: ShootingStarData[] = [];
    for (let i = 0; i < 4; i++) {
      shooterList.push({
        id: i,
        startX: Math.random() * 40,
        startY: Math.random() * 30,
        delay: i * 4 + Math.random() * 2,
        duration: Math.random() * 0.8 + 1,
      });
    }
    setShooters(shooterList);
  }, []);

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      zIndex: 0,
    }}>
      {/* Deep gradient background */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse 70% 60% at 50% 30%, #0a1a40 0%, #06102d 30%, #030818 60%, #01040d 100%)",
      }} />

      {/* Subtle nebula glow */}
      <div style={{
        position: "absolute",
        top: "15%",
        left: "20%",
        width: "40%",
        height: "30%",
        background: "radial-gradient(ellipse, rgba(37,99,235,0.08) 0%, transparent 70%)",
        borderRadius: "50%",
        filter: "blur(60px)",
      }} />
      <div style={{
        position: "absolute",
        top: "10%",
        right: "15%",
        width: "30%",
        height: "25%",
        background: "radial-gradient(ellipse, rgba(0,196,180,0.05) 0%, transparent 70%)",
        borderRadius: "50%",
        filter: "blur(50px)",
      }} />

      {/* Stars */}
      {stars.map((s) => (
        <div
          key={s.id}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            background: s.color,
            opacity: s.opacity,
            boxShadow: s.size > 1.2 ? `0 0 ${s.size * 3}px ${s.color}40` : "none",
            animation: `starTwinkle ${s.duration}s ease-in-out ${s.delay}s infinite alternate`,
          }}
        />
      ))}

      {/* Shooting stars */}
      {shooters.map((ss) => (
        <div
          key={ss.id}
          style={{
            position: "absolute",
            left: `${ss.startX}%`,
            top: `${ss.startY}%`,
            width: 100,
            height: 2,
            background: "linear-gradient(90deg, transparent, rgba(0,196,180,0.8), rgba(255,255,255,0.9))",
            borderRadius: 1,
            transform: "rotate(-25deg)",
            opacity: 0,
            animation: `shootingStar ${ss.duration}s linear ${ss.delay}s infinite`,
            boxShadow: "0 0 6px rgba(0,196,180,0.4)",
          }}
        />
      ))}

      {/* Bottom fog transition */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "35%",
        background: "linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.02) 30%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.12) 100%)",
        pointerEvents: "none",
      }} />
    </div>
  );
}
