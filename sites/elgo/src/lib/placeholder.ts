const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Экранирует текст и оборачивает [плейсхолдеры] в <span class="placeholder">. */
export function markPlaceholders(text: string): string {
  return text
    .replace(/[&<>"']/g, (c) => ESC[c]!)
    .replace(/\[([^\]]+)\]/g, '<span class="placeholder">[$1]</span>');
}
