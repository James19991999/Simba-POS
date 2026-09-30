export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-space-2xl text-on-surface-variant">
      <p className="font-headline-sm text-on-surface">{title}</p>
      {hint && <p className="font-body-sm mt-space-xs max-w-sm">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-space-2xl">
      <p className="font-headline-sm text-critical">Something went wrong</p>
      <p className="font-body-sm text-on-surface-variant mt-space-xs max-w-sm">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-space-md text-primary-action font-label-lg underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function LoadingState() {
  return <div className="p-space-2xl text-center text-on-surface-variant font-body-sm">Loading…</div>;
}
