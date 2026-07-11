import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum SsoProviderType {
  SAML = 'saml',
  OIDC = 'oidc',
  GOOGLE = 'google',
  LDAP = 'ldap',
}

export class SsoProviderIdDto {
  @IsUUID()
  providerId: string;
}

export class CreateSsoProviderDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsEnum(SsoProviderType)
  type: SsoProviderType;
}

export class UpdateSsoProviderDto extends SsoProviderIdDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  samlUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  samlCertificate?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  oidcIssuer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  oidcClientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  oidcClientSecret?: string;

  @IsOptional()
  @IsUrl({ protocols: ['ldap', 'ldaps'], require_protocol: true })
  @MaxLength(2048)
  ldapUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ldapBindDn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  ldapBindPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ldapBaseDn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  ldapUserSearchFilter?: string;

  @IsOptional()
  @IsObject()
  ldapUserAttributes?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  ldapTlsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  ldapTlsCaCert?: string;

  @IsOptional()
  @IsBoolean()
  allowSignup?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  groupSync?: boolean;
}
