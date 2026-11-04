export interface AuthUser {
  id: string;
  email: string;
  companyId: string;
  companyName: string;
  role: string;
}

export interface AuthSession {
  user: AuthUser;
  expiresInSeconds: number;
}

export interface CurrentUser {
  userId: string;
  email: string;
  companyId: string;
  role: string;
}

export interface AuthDocumentVersions {
  termsVersion: string;
  privacyVersion: string;
}
