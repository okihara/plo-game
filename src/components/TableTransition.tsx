interface TableTransitionProps {
  visible: boolean;
}

export function TableTransition({ visible }: TableTransitionProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[1000] animate-fade-in">
      <div className="text-white text-2xl font-bold text-center">
        テーブル移動中...
      </div>
    </div>
  );
}
