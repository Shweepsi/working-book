// The header's tool icons, shared by its buttons and its menu (ToolsMenu.tsx).

export function BilanIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="1.75" width="12" height="12.5" rx="1.5" />
      <path d="M5 11.25V9M8 11.25V5.5M11 11.25V7.5" strokeWidth="1.8" />
    </svg>
  );
}

export function CalcIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="1.75" width="10" height="12.5" rx="1.5" />
      <rect x="5.25" y="4" width="5.5" height="2.5" rx="0.5" />
      <path d="M5.5 9h.01M8 9h.01M10.5 9h.01M5.5 11.5h.01M8 11.5h.01M10.5 11.5h.01" strokeWidth="1.8" />
    </svg>
  );
}

export function PrintIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 5.75V1.75h7v4" />
      <rect x="1.75" y="5.75" width="12.5" height="6" rx="1.5" />
      <rect x="4.5" y="9.25" width="7" height="5" rx="0.5" fill="var(--paper)" />
      <path d="M11.5 7.9h.01" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 4.25h11M2.5 8h11M2.5 11.75h11" />
    </svg>
  );
}
