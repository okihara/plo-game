import { useEffect, useState } from 'react';
import { HandDetailDialog } from '../components/HandDetailDialog';
import type { HandDetail } from '../components/HandDetailDialog';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface HandDetailPageProps {
  handId: string;
  onBack: () => void;
}

export function HandDetailPage({ handId, onBack }: HandDetailPageProps) {
  const [hand, setHand] = useState<HandDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/hand/${handId}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'ハンドが見つかりません' : 'エラーが発生しました');
        return res.json();
      })
      .then(data => setHand(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [handId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center light-bg">
        <span className="text-cream-600 text-[3.5cqw]">読み込み中...</span>
      </div>
    );
  }

  if (error || !hand) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center light-bg gap-[4cqw]">
        <span className="text-cream-600 text-[3.5cqw]">{error || 'ハンドが見つかりません'}</span>
        <button
          onClick={onBack}
          className="text-forest text-[3cqw] font-semibold underline"
        >
          トップへ戻る
        </button>
      </div>
    );
  }

  return <HandDetailDialog hand={hand} onClose={onBack} />;
}
