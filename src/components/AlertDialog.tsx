import type { ReactNode } from 'react';
import { useId } from 'react';

const CARD_CLASS =
  'text-center border border-cream-300 rounded-[4cqw] px-[8cqw] py-[10cqw] w-full max-w-[min(92vw,36rem)] shadow-[0_4px_24px_rgba(0,0,0,0.35)] bg-white';

const PRIMARY_BUTTON_CLASS =
  'w-full py-[3cqw] px-[6cqw] border border-cream-300 rounded-[3cqw] font-bold text-cream-700 hover:border-cream-400 transition-all';

export type AlertDialogCardProps = {
  /** `aria-labelledby` / 見出しの id */
  titleId: string;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  adornment?: ReactNode;
};

/**
 * クリーム系のカードだけ（全画面レイアウトでラップするときに使用）
 */
export function AlertDialogCard({
  titleId,
  title,
  description,
  primaryLabel,
  onPrimary,
  adornment = '!',
}: AlertDialogCardProps) {
  return (
    <div className={CARD_CLASS}>
      <div className="text-[#C0392B] mb-[3cqw]" style={{ fontSize: '12cqw' }} aria-hidden>
        {adornment}
      </div>
      <h2 id={titleId} className="text-cream-900 font-bold mb-[2cqw]" style={{ fontSize: '5cqw' }}>
        {title}
      </h2>
      <p className="text-cream-600 mb-[6cqw]" style={{ fontSize: '3.5cqw' }}>
        {description}
      </p>
      <button
        type="button"
        onClick={onPrimary}
        className={PRIMARY_BUTTON_CLASS}
        style={{ fontSize: '3.5cqw' }}
      >
        {primaryLabel}
      </button>
    </div>
  );
}

const DEFAULT_OVERLAY_BACKDROP =
  'fixed inset-0 z-[240] flex items-center justify-center bg-black/50 px-[5cqw]';

export type AlertDialogOverlayProps = Omit<AlertDialogCardProps, 'titleId'> & {
  overlayClassName?: string;
};

/**
 * 半透明背景＋中央カード（ゲーム画面などに fixed で重ねる）
 */
export function AlertDialogOverlay({
  overlayClassName = DEFAULT_OVERLAY_BACKDROP,
  title,
  description,
  primaryLabel,
  onPrimary,
  adornment,
}: AlertDialogOverlayProps) {
  const titleId = useId();

  return (
    <div
      className={overlayClassName}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <AlertDialogCard
        titleId={titleId}
        title={title}
        description={description}
        primaryLabel={primaryLabel}
        onPrimary={onPrimary}
        adornment={adornment}
      />
    </div>
  );
}
