interface BustedScreenProps {
  message: string;
}

export function BustedScreen({ message }: BustedScreenProps) {
  return (
    <div className="h-full w-full light-bg flex items-center justify-center p-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cream-300 border-t-forest mx-auto mb-4"></div>
        <h2 className="text-cream-900 text-xl font-bold mb-2">{message}</h2>
        <p className="text-cream-600">ロビーに戻ります...</p>
      </div>
    </div>
  );
}
