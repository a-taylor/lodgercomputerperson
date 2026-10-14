// A tiny element builder. Text always goes in as text, never as HTML.
type Child = Node | string | null | false | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | ((e: Event) => void)>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}
