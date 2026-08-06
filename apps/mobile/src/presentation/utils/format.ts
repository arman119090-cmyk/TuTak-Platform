export function formatAmd(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} AMD`;
}

export function formatPoints(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}
