/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Motion module — GSAP + Lenis wired as thin React hooks so components
// stay declarative.  Bundle cost: ~75 KB raw / ~25 KB gz (GSAP core +
// Lenis), single-occurrence — both are tree-shake-safe.

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import Lenis from "lenis";

/**
 * useLenis(targetSelector) — install Lenis smooth scroll on the
 * given element (or window if omitted). The instance is started once
 * per mount and cleaned up on unmount. Pulses RAF until torn down.
 *
 * For dashboards, run it on the <main> scroll container so the body
 * stays default-scroll (otherwise nested-scroll edge cases get gnarly).
 */
export function useLenis(targetSelector) {
  const lenisRef = useRef(null);
  useEffect(() => {
    const el = targetSelector ? document.querySelector(targetSelector) : null;
    const lenis = new Lenis({
      wrapper: el ?? undefined,
      content: el?.firstElementChild ?? undefined,
      duration: 0.9,            // a touch faster than default (1.2)
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Touch devices keep native scroll — Lenis on iOS scrollers
      // fights momentum and feels worse, not better.
      syncTouch: false,
    });
    lenisRef.current = lenis;
    let raf = 0;
    const tick = (time) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [targetSelector]);
  return lenisRef;
}

/**
 * usePageTransition(deps) — fade-and-slight-rise the current children
 * whenever `deps` changes. Used by the app shell to make tab switches
 * feel like a transition instead of a yank.
 *
 * Tied to a ref instead of a global selector so it never animates the
 * wrong element if two shells exist in the tree (storybook-style).
 */
export function usePageTransition(ref, deps) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    gsap.fromTo(
      el,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" },
    );
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * useStagger(rootRef, selector, deps) — cascade-in children matching
 * `selector` inside `rootRef`. Cheap stagger (0.04s per item) capped at
 * 12 elements so a 200-row list doesn't grind. Useful for the Overview
 * cards and the Skills/Memories first paint.
 */
export function useStagger(rootRef, selector, deps) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const items = Array.from(root.querySelectorAll(selector)).slice(0, 12);
    if (items.length === 0) return undefined;
    gsap.fromTo(
      items,
      { opacity: 0, y: 6 },
      {
        opacity: 1, y: 0,
        duration: 0.32,
        ease: "power2.out",
        stagger: 0.04,
      },
    );
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * useCountUp(ref, value) — animate a number element from its current
 * displayed value up to `value`. Adds polish on the Overview counters.
 * The element should render the value as text content; the hook
 * overwrites it during the animation and on completion.
 */
export function useCountUp(ref, value) {
  const prevRef = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const obj = { n: prevRef.current };
    gsap.to(obj, {
      n: value,
      duration: 0.6,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = Math.round(obj.n).toLocaleString();
      },
      onComplete: () => {
        el.textContent = value.toLocaleString();
        prevRef.current = value;
      },
    });
    return undefined;
  }, [ref, value]);
}
