interface ShareButtonProps {
  winAmount: number;
  handName?: string;
  blinds: string;
}

export function ShareButton({ winAmount, handName, blinds }: ShareButtonProps) {
  const handleShare = () => {
    const handText = handName ? `（${handName}）` : '';
    const text = `Baby PLOで +${winAmount} チップ獲得！${handText}\nPLO ${blinds} で対戦中`;
    const url = window.location.origin;
    const twitterUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(twitterUrl, '_blank', 'width=550,height=420');
  };

  return (
    <button
      onClick={handleShare}
      className="animate-fade-in px-[3cqw] py-[1.5cqw] bg-black/80 text-white rounded-full text-[3cqw] font-bold border border-white/20 hover:bg-white/20 active:scale-95 transition-all flex items-center gap-[1.5cqw]"
    >
      <svg viewBox="0 0 24 24" className="w-[3.5cqw] h-[3.5cqw] fill-current">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      シェア
    </button>
  );
}
