"use client";

import { useEffect, useRef } from "react";

/**
 * Put inside a horizontally scrolling tab bar: on each navigation it scrolls the bar (only the bar, not the page)
 * so the current tab (aria-current) is visible. Renders an empty, hidden span.
 */
export function KeepActiveVisible({ dep }: { dep?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bar = ref.current?.parentElement;
    const tab = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !tab) return;
    const left = tab.offsetLeft - bar.offsetLeft;
    if (left < bar.scrollLeft || left + tab.offsetWidth > bar.scrollLeft + bar.clientWidth)
      bar.scrollLeft = left - (bar.clientWidth - tab.offsetWidth) / 2;
  }, [dep]);
  return <span ref={ref} hidden />;
}
