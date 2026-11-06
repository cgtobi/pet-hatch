import { icon, type IconName } from './icons';

export interface MenuItem {
  icon: IconName;
  label: string;
  /** Small text after the label, e.g. "12/36". */
  note?: string;
  /** A highlighted tag, e.g. "New". */
  tag?: string;
  onPick(): void;
}

let open: { menu: HTMLElement; close(): void } | null = null;

/** A small menu dropping down from its button; tapping the button again, outside it or Escape closes it. */
export function toggleMenu(anchor: HTMLElement, items: MenuItem[]): void {
  if (open) return open.close();

  const menu = document.createElement('div');
  menu.className = 'menu card';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.innerHTML = icon(item.icon, 20);
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = item.label;
    b.append(label);
    if (item.note)
      b.append(
        Object.assign(document.createElement('small'), {
          textContent: item.note,
        }),
      );
    if (item.tag)
      b.append(
        Object.assign(document.createElement('span'), {
          className: 'book-new menu-tag',
          textContent: item.tag,
        }),
      );
    b.onclick = () => {
      close();
      item.onPick();
    };
    menu.append(b);
  }

  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 8}px`;
  menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  anchor.setAttribute('aria-expanded', 'true');

  const outside = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!menu.contains(target) && !anchor.contains(target)) close();
  };
  const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const close = () => {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', key);
    open = null;
  };
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', key);
  anchor.parentElement!.closest('#app, body')!.append(menu);
  open = { menu, close };
  (menu.firstElementChild as HTMLElement | null)?.focus({
    preventScroll: true,
  });
}
