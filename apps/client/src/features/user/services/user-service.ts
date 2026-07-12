import api from "@/lib/api-client";
import { ICurrentUser, IUser } from "@/features/user/types/user.types";

export async function getMyInfo(): Promise<ICurrentUser> {
  const req = await api.post<ICurrentUser>("/users/me");
  return req.data as ICurrentUser;
}

export async function updateUser(data: Partial<IUser>): Promise<IUser> {
  const req = await api.post<IUser>("/users/update", data);
  return req.data as IUser;
}

export async function requestEmailChange(data: {
  email: string;
  password: string;
}): Promise<{ expiresAt: string }> {
  const req = await api.post<{ expiresAt: string }>(
    "/users/email-change/request",
    data,
  );
  return req.data as { expiresAt: string };
}

export async function confirmEmailChange(
  token: string,
): Promise<{ email: string }> {
  const req = await api.post<{ email: string }>("/users/email-change/confirm", {
    token,
  });
  return req.data as { email: string };
}
