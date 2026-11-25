import { OAuth2Client } from "google-auth-library";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Google Drive storage for bill photos and bank screenshots.
 *
 * The admin pastes a Drive folder link in Settings and connects their Google account once.
 * We keep the admin's refresh token in Firestore `private/drive` (no client can read it), so the
 * files are owned by the admin's Drive, never by a staff phone's Drive.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export function oauthClient(clientId: string, clientSecret: string, redirectUri?: string) {
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

/** Accepts a folder link (https://drive.google.com/drive/folders/<id>?usp=...) or a bare id. */
export function folderIdFromLink(link: string): string | null {
  const m = link.match(/folders\/([a-zA-Z0-9_-]{10,})/) ?? link.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) ?? link.trim().match(/^([a-zA-Z0-9_-]{10,})$/);
  return m ? m[1] : null;
}

export interface DriveConfig { folderId: string; refreshToken: string }

export async function driveConfig(): Promise<DriveConfig | null> {
  const db = getFirestore();
  const [settings, priv] = await Promise.all([db.doc("settings/app").get(), db.doc("private/drive").get()]);
  const folderId = settings.get("driveFolderId");
  const refreshToken = priv.get("refreshToken");
  return folderId && refreshToken ? { folderId, refreshToken } : null;
}

export class Drive {
  private client: OAuth2Client;
  private folders = new Map<string, string>();
  constructor(clientId: string, clientSecret: string, refreshToken: string) {
    this.client = oauthClient(clientId, clientSecret);
    this.client.setCredentials({ refresh_token: refreshToken });
  }

  private async req<T = any>(url: string, init: { method?: string; headers?: Record<string, string>; body?: any } = {}): Promise<T> {
    const res = await this.client.request<T>({ url, method: (init.method ?? "GET") as any, headers: init.headers, data: init.body, responseType: url.includes("alt=media") ? "arraybuffer" : "json" });
    return res.data;
  }

  async folderInfo(folderId: string) {
    return this.req<{ id: string; name: string; mimeType: string; capabilities?: { canAddChildren?: boolean } }>(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`
    );
  }

  /** Find or create a sub-folder path like ["2026-11", "Vendor bills"] under the root folder. */
  async ensurePath(rootId: string, parts: string[]) {
    let parent = rootId;
    for (const name of parts) {
      const key = parent + "/" + name;
      let id = this.folders.get(key);
      if (!id) {
        const q = encodeURIComponent(`'${parent}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
        const found = await this.req<{ files: { id: string }[] }>(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
        id = found.files[0]?.id;
        if (!id) {
          const made = await this.req<{ id: string }>(`https://www.googleapis.com/drive/v3/files?supportsAllDrives=true`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: { name, mimeType: "application/vnd.google-apps.folder", parents: [parent] },
          });
          id = made.id;
        }
        this.folders.set(key, id);
      }
      parent = id;
    }
    return parent;
  }

  async upload(parentId: string, name: string, data: Buffer, mimeType: string, description?: string) {
    const boundary = "annapoorna" + Date.now();
    const meta = JSON.stringify({ name, parents: [parentId], description });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return this.req<{ id: string; webViewLink: string }>(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body }
    );
  }

  async rename(fileId: string, name: string) {
    await this.req(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: { name } });
  }

  async download(fileId: string): Promise<Buffer> {
    const data = await this.req<ArrayBuffer>(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
    return Buffer.from(data);
  }
}

export const TYPE_FOLDER: Record<string, string> = {
  sales: "Daily sales",
  cashout: "Cash out",
  vendor_bill: "Vendor bills",
  wastage: "Wastage",
  payment: "Bank payments",
};

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
