interface ThinkingIndicatorProps {
  playerName: string;
  visible: boolean;
}

export function ThinkingIndicator({ playerName, visible }: ThinkingIndicatorProps) {
  if (!visible) return null;

  return (
    <div className="absolute top-[2vh] left-1/2 -translate-x-1/2 bg-black/80 px-[2vh] py-[1vh] rounded-full text-[1.5vh] text-yellow-400 flex items-center gap-[1vh] z-50">
      <span>{playerName}が考え中</span>
      <div className="flex gap-[0.5vh]">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-[0.8vh] h-[0.8vh] bg-yellow-400 rounded-full animate-thinking"
            style={{ animationDelay: `${-0.32 + i * 0.16}s` }}
          />
        ))}
      </div>
    </div>
  );
}
