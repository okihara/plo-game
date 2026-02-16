import { HandHistoryPanel } from '../components/HandHistoryPanel';

interface HandHistoryProps {
  onBack: () => void;
}

export function HandHistory({ onBack }: HandHistoryProps) {
  return (
    <div className="h-full bg-gradient-to-br from-green-950 via-emerald-950 to-black">
      <HandHistoryPanel onClose={onBack} />
    </div>
  );
}
