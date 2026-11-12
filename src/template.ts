export function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function expandTemplate(source: string, title: string, date: Date): string {
  return source
    .replaceAll("{{date}}", formatDate(date))
    .replaceAll("{{time}}", formatTime(date))
    .replaceAll("{{title}}", title);
}

export function dailyFileName(date = new Date()): string {
  return `${formatDate(date)}.md`;
}

export function joinPath(folder: string, name: string): string {
  const clean = folder.replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/${name}` : name;
}
