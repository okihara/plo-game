import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

export interface PlayerLabel {
  targetUserId: string;
  color: string;
  note: string;
}

export const LABEL_COLORS = [
  { id: 'red', hex: '#ef4444' },
  { id: 'blue', hex: '#3b82f6' },
  { id: 'green', hex: '#22c55e' },
  { id: 'yellow', hex: '#facc15' },
  { id: 'gray', hex: '#9ca3af' },
] as const;

export function usePlayerLabels() {
  const { user } = useAuth();
  const [labels, setLabels] = useState<Map<string, PlayerLabel>>(new Map());

  // 全ラベルを取得
  useEffect(() => {
    if (!user) return;

    fetch(`${API_BASE}/api/labels`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.labels) {
          const map = new Map<string, PlayerLabel>();
          for (const label of data.labels) {
            map.set(label.targetUserId, label);
          }
          setLabels(map);
        }
      })
      .catch(() => {});
  }, [user]);

  const getLabel = useCallback((targetUserId: string): PlayerLabel | undefined => {
    return labels.get(targetUserId);
  }, [labels]);

  const setLabel = useCallback(async (targetUserId: string, color: string, note: string) => {
    const res = await fetch(`${API_BASE}/api/labels/${targetUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ color, note }),
    });
    if (res.ok) {
      const data = await res.json();
      setLabels(prev => {
        const next = new Map(prev);
        next.set(targetUserId, data.label);
        return next;
      });
    }
  }, []);

  const removeLabel = useCallback(async (targetUserId: string) => {
    const res = await fetch(`${API_BASE}/api/labels/${targetUserId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      setLabels(prev => {
        const next = new Map(prev);
        next.delete(targetUserId);
        return next;
      });
    }
  }, []);

  return { labels, getLabel, setLabel, removeLabel };
}
