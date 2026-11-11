'use client';

import { useTranslations } from 'next-intl';

type Props = {
  onClick: () => void;
};

export default function LoadMoreButton({ onClick }: Props) {
  const tCommon = useTranslations('common');
  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="rounded-full border border-border bg-background px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        {tCommon('loadMore')}
      </button>
    </div>
  );
}
