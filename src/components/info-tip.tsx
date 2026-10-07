import { METRICS } from "@/lib/metrics/config";
import { Tooltip } from "./tooltip";

/** Glossary "?" button with a plain-language definition. */
export function InfoTip({ text, label }: { text: string; label: string }) {
  return <Tooltip title={label} text={text} />;
}

/** Metric label with its glossary tooltip from the metric config. */
export function MetricLabel({ metricKey, label, className }: { metricKey: string; label?: string; className?: string }) {
  const def = METRICS[metricKey];
  const text = label ?? def?.label ?? metricKey;
  return (
    <span className={className}>
      {text}
      {def && <InfoTip text={def.definition} label={def.label} />}
    </span>
  );
}
