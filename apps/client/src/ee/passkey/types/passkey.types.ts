import { ILoginResponse } from "@/features/auth/types/auth.types";

export interface PasskeyStatus {
  available: boolean;
  expectedOrigin: string | null;
  rpId: string | null;
}

export interface PasskeyItem {
  id: string;
  name: string;
  deviceType: "singleDevice" | "multiDevice" | string;
  backedUp: boolean;
  disabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeyOptionsResponse {
  challengeId: string;
  options: Record<string, unknown>;
}

export type PasskeyAuthenticationResult = ILoginResponse | undefined;
