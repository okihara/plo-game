interface ThinkingIndicatorProps {
  playerName: string;
  visible: boolean;
}

export function ThinkingIndicator({ playerName, visible }: ThinkingIndicatorProps) {
  if (!visible) return null;

  return (
    <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-black/80 px-5 py-2 rounded-full text-xs text-yellow-400 flex items-center gap-2 z-50">
      <span>{playerName}が考え中</span>
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-thinking"
            style={{ animationDelay: `${-0.32 + i * 0.16}s` }}
          />
        ))}
      </div>
    </div>
  );
}
