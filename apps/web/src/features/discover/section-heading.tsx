/** Discover section title with the small honey marker from the design. */
export function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2
      id={id}
      className="flex items-center gap-2 px-1 font-display text-[17px] font-medium text-ink"
    >
      <span
        aria-hidden
        className="size-2 rounded-[3px] bg-honey ring-[3px] ring-honey-deep ring-inset"
      />
      {children}
    </h2>
  );
}
