// The Flux sun blob (from flux.am design/shapes/sun.svg), used as the app
// mark. Decorative: the "Floaters" wordmark next to it carries the name.
export default function FluxMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="-6 0 226 194" className={className} aria-hidden="true" focusable="false">
      <g fill="hsl(var(--sun))">
        <path d="M28 112 C24 82 44 64 66 52 C90 38 112 20 136 26 C150 30 158 40 170 42 C186 46 194 64 198 82 C204 100 214 116 200 128 C186 138 176 132 164 140 C150 150 142 166 124 162 C108 158 100 146 86 150 C70 154 62 168 46 160 C30 152 30 132 28 112 Z" />
        <circle cx="162" cy="36" r="16" />
        <circle cx="84" cy="176" r="10" />
      </g>
      <circle cx="206" cy="146" r="6" fill="hsl(var(--coral))" />
    </svg>
  );
}
