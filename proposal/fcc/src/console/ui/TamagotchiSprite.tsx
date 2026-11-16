import { useEffect, useState } from 'react';

type TamagotchiSpriteProps = {
  character?: 'chief' | 'ranger' | 'rescue' | 'scout';
  state?: 'idle' | 'thinking' | 'working' | 'alert';
  size?: 16 | 32 | 64;
  paused?: boolean;
};

const states = ['idle', 'thinking', 'working', 'alert'] as const;

function TamagotchiSprite({ character = 'chief', state = 'idle', size = 32, paused = false }: TamagotchiSpriteProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const sync = () => {
      stop();
      setFrame(0);
      if (!paused && !motion.matches && !document.hidden) {
        timer = setInterval(() => setFrame((current) => (current + 1) % 16), 160);
      }
    };
    sync();
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      stop();
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [character, state, paused]);

  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size, height: size,
        backgroundImage: `url(/mascots/${character}.png)`,
        backgroundSize: `${size * 16}px ${size * 4}px`,
        backgroundPosition: `${-frame * size}px ${-states.indexOf(state) * size}px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
      }}
    />
  );
}

export { TamagotchiSprite };
