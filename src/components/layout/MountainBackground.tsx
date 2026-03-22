import { useEffect, useRef } from 'react';

export function MountainBackground() {
  const starsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = starsRef.current;
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 60; i++) {
      const star = document.createElement('div');
      star.className = 'absolute w-0.5 h-0.5 rounded-full bg-snow';
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.animationDelay = `${Math.random() * 3}s`;
      star.style.opacity = String(Math.random() * 0.5 + 0.1);
      star.style.animation = `twinkle ${2 + Math.random() * 2}s ease-in-out infinite alternate`;
      container.appendChild(star);
    }
  }, []);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[hsl(210,40%,7%)] via-background to-ridge" />
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse 120% 60% at 20% 80%, hsla(140,35%,38%,0.06) 0%, transparent 60%), radial-gradient(ellipse 100% 50% at 80% 70%, hsla(210,55%,78%,0.04) 0%, transparent 50%)'
      }} />
      <div ref={starsRef} className="absolute top-0 left-0 right-0 h-[50vh]" />
      <div className="absolute bottom-0 left-0 right-0 h-[45vh] opacity-[0.12]">
        <svg viewBox="0 0 1440 400" preserveAspectRatio="none" className="w-full h-full">
          <polygon fill="hsl(213,32%,15%)" points="0,400 0,280 120,200 240,260 360,160 480,220 600,120 720,180 840,80 960,160 1080,100 1200,180 1320,140 1440,200 1440,400"/>
          <polygon fill="hsl(213,28%,13%)" points="0,400 0,320 180,260 360,300 540,220 720,280 900,200 1080,260 1260,220 1440,280 1440,400"/>
        </svg>
      </div>
    </div>
  );
}
