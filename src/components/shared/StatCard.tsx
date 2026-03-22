interface Props {
  value: string;
  label: string;
  sub: string;
  colorClass?: string;
}

export function StatCard({ value, label, sub, colorClass = 'text-snow' }: Props) {
  return (
    <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-5 text-center transition-all duration-300 hover:border-border/60">
      <div className={`font-mono text-[2rem] font-medium leading-none mb-1 ${colorClass}`}>{value}</div>
      <div className="text-[0.7rem] font-semibold text-granite uppercase tracking-[0.12em]">{label}</div>
      <div className="text-[0.65rem] text-granite/70 mt-0.5 font-mono">{sub}</div>
    </div>
  );
}
