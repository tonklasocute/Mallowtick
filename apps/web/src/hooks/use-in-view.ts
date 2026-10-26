"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once the element has been on screen; it stays true afterwards. Hidden
 * elements (display: none) never intersect, so they never report in view.
 * Without IntersectionObserver (e.g. jsdom) everything counts as in view.
 */
export function useInView<T extends Element>(rootMargin = "100px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(
    () => typeof window !== "undefined" && !("IntersectionObserver" in window),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView] as const;
}
