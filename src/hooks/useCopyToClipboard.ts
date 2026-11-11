'use client';

import { useState } from 'react';

export function useCopyToClipboard(timeoutMs = 2000) {
  const [copied, setCopied] = useState(false);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), timeoutMs);
    });
  }

  return { copied, copy };
}
