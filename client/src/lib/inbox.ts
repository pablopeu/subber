/**
 * Server inbox: files dropped into the <repo>/temp folder on the server
 * machine are listed here so they can be imported from the browser with
 * one click (handy when the media lives on the server, not the client).
 */

export interface InboxFile {
  name: string;
  size: number;
  mtime: number;
  kind: 'video' | 'subtitle';
}

export async function listInbox(): Promise<InboxFile[]> {
  const res = await fetch('/api/inbox');
  if (!res.ok) return [];
  return res.json();
}

export async function fetchInboxFile(file: InboxFile): Promise<File> {
  const res = await fetch(`/api/inbox/${encodeURIComponent(file.name)}`);
  if (!res.ok) throw new Error(`Could not fetch ${file.name} (HTTP ${res.status})`);
  const blob = await res.blob();
  return new File([blob], file.name, { type: blob.type });
}
