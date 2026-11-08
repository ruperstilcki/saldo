/** "Tekući račun PS" -> "TR"; a single word -> its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]!.slice(0, 1) + words[1]!.slice(0, 1)).toUpperCase()
}

/** Lowercase without diacritics: "Šumadija" -> "sumadija", "Đ" -> "dj". */
export function fold(text: string): string {
  return text
    .replace(/đ/g, 'dj')
    .replace(/Đ/g, 'Dj')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}
