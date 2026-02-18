import { HandHistoryPanel } from '../components/HandHistoryPanel';

interface HandHistoryProps {
  onBack: () => void;
}

export function HandHistory({ onBack }: HandHistoryProps) {
  return (
    <div className="h-full light-bg">
      <HandHistoryPanel onClose={onBack} />
    </div>
  );
}
