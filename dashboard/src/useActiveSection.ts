import { useEffect, useState } from "react";

/**
 * Scroll-spy for long reference pages: returns the id of the section currently
 * being read. Section elements must have id `${prefix}${id}`. A section is
 * "current" while it crosses a thin band near the top of the viewport; at the
 * very bottom of the page the last section wins, since short final sections
 * may never reach that band.
 */
export function useActiveSection(ids: string[], prefix: string) {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const elements = ids
      .map(id => document.getElementById(`${prefix}${id}`))
      .filter((el): el is HTMLElement => el !== null);
    const visible = new Set<string>();

    const pick = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) return setActive(ids[ids.length - 1]);
      const first = ids.find(id => visible.has(id));
      if (first) setActive(first);
    };

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = entry.target.id.slice(prefix.length);
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      pick();
    }, { rootMargin: "-15% 0px -80% 0px" });

    elements.forEach(el => observer.observe(el));
    window.addEventListener("scroll", pick, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", pick);
    };
  }, [ids, prefix]);

  return active;
}

/** Keep the highlighted sidebar link visible when the sidebar itself scrolls. */
export function scrollNavToActive(nav: HTMLElement | null, active: string) {
  const link = nav?.querySelector<HTMLElement>(`[data-section="${active}"]`);
  if (!nav || !link || nav.scrollHeight <= nav.clientHeight) return;
  const top = link.offsetTop - nav.offsetTop;
  if (top < nav.scrollTop || top + link.offsetHeight > nav.scrollTop + nav.clientHeight) {
    nav.scrollTo({ top: top - nav.clientHeight / 3 });
  }
}
