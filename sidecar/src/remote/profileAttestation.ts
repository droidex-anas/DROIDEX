import {
  HANDLE_PATTERN,
  isProfilePayload,
  profileShareProof,
  signIdentity,
  type Identity,
  type ProfileAttestation,
} from '../../../packages/remote/src/index.js';

export async function createProfileAttestation(
  identity: Identity | null,
  authenticatorReady: boolean,
  username: string,
  payload: unknown,
): Promise<ProfileAttestation> {
  if (!identity || !authenticatorReady || !HANDLE_PATTERN.test(username)) {
    throw new Error('Finish remote authenticator setup before sharing your profile');
  }
  if (!isProfilePayload(payload)) {
    throw new Error('Invalid profile payload');
  }
  return {
    username,
    publicKey: identity.publicKey,
    signature: await signIdentity(identity.privateKey, profileShareProof(username, payload)),
  };
}
