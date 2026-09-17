interface DesktopRemoteStatus {
  enabled: boolean;
  enabling?: boolean;
  computerName?: string;
  workspace?: string;
  addresses?: string[];
  address?: string;
  code?: string;
  qrImage?: string;
  expiresAt?: number;
  expired?: boolean;
  pending?: { id: string; name: string };
  device?: { id: string; name: string };
  connected?: boolean;
  lastSeenAt?: number;
  models?: number;
  sessions?: number;
  running?: number;
  sync?: { state: string; message: string };
}
interface DroidexRemoteControl {
  control(operation: 'status' | 'renew' | 'disable'): Promise<DesktopRemoteStatus>;
  control(operation: 'enable', value: { workspace: string; address: string }): Promise<DesktopRemoteStatus>;
  control(operation: 'approve', value: { id: string; allow: boolean }): Promise<DesktopRemoteStatus>;
  control(operation: 'folder'): Promise<string | null>;
  control(operation: 'copy'): Promise<boolean>;
}
interface Window { droidexRemote?: DroidexRemoteControl }
