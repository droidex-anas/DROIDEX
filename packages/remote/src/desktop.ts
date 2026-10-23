export interface RemoteProfile {
  displayName: string;
  username: string;
}
export type TrustDays = 0 | 1 | 7 | 30;
export interface RemoteDevice {
  id: string;
  name: string;
  publicKey: JsonWebKey;
  expiresAt: number;
  lastSeenAt: number;
}
export interface RemotePending {
  id: string;
  title: string;
  detail: string;
  expiresAt: number;
}
export interface RemoteSettings {
  profile: RemoteProfile;
  enabled: boolean;
  relayUrl: string;
  clientUrl: string;
  trustDays: TrustDays;
  keepAwake: boolean;
  workspace: string;
}
export interface RemoteState extends RemoteSettings {
  status: 'off' | 'connecting' | 'connected' | 'error';
  error?: string;
  devices: RemoteDevice[];
  /** Browsers approved for their current connection only, while they stay connected. */
  temporaryDevices: RemoteDevice[];
  pending: RemotePending[];
  pairingUrl?: string;
  authenticatorReady: boolean;
}
export interface RemoteSetup {
  secret: string;
  uri: string;
}
