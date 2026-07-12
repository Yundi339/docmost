import api from "@/lib/api-client";
import {
  PasskeyAuthenticationResult,
  PasskeyItem,
  PasskeyOptionsResponse,
  PasskeyStatus,
} from "@/ee/passkey/types/passkey.types";

export async function getPasskeyStatus(): Promise<PasskeyStatus> {
  const response = await api.post<PasskeyStatus>("/auth/passkeys/status");
  return response.data;
}

export async function getPasskeyAuthenticationOptions(): Promise<PasskeyOptionsResponse> {
  const response = await api.post<PasskeyOptionsResponse>(
    "/auth/passkeys/authentication/options",
  );
  return response.data;
}

export async function verifyPasskeyAuthentication(data: {
  challengeId: string;
  credential: Record<string, unknown>;
}): Promise<PasskeyAuthenticationResult> {
  const response = await api.post<PasskeyAuthenticationResult>(
    "/auth/passkeys/authentication/verify",
    data,
  );
  return response.data;
}

export async function listPasskeys(): Promise<PasskeyItem[]> {
  const response = await api.post<PasskeyItem[]>("/passkeys/list");
  return response.data;
}

export async function getPasskeyRegistrationOptions(data: {
  currentPassword: string;
}): Promise<PasskeyOptionsResponse> {
  const response = await api.post<PasskeyOptionsResponse>(
    "/passkeys/registration/options",
    data,
  );
  return response.data;
}

export async function verifyPasskeyRegistration(data: {
  challengeId: string;
  name: string;
  credential: Record<string, unknown>;
}): Promise<PasskeyItem> {
  const response = await api.post<PasskeyItem>(
    "/passkeys/registration/verify",
    data,
  );
  return response.data;
}

export async function renamePasskey(data: {
  passkeyId: string;
  name: string;
}): Promise<PasskeyItem> {
  const response = await api.post<PasskeyItem>("/passkeys/update", data);
  return response.data;
}

export async function deletePasskey(data: {
  passkeyId: string;
  currentPassword: string;
}): Promise<void> {
  await api.post("/passkeys/delete", data);
}
