/** Asia/Shanghai timestamps for claims and mirrors. */

export function formatShanghai(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  let hour = pick("hour");
  if (hour === "24") hour = "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${hour}:${pick("minute")}:${pick("second")}+08:00`;
}

export function shanghaiYmd(date = new Date()) {
  return formatShanghai(date).slice(0, 10);
}
