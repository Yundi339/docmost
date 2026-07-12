import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SetupMfaDto {
  @IsOptional()
  @IsIn(['totp'])
  method?: string;
}

export class EnableMfaDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  secret: string;

  @IsString()
  @Matches(/^\d{6}$/)
  verificationCode: string;
}

export class MfaPasswordStepUpDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(70)
  confirmPassword?: string;
}

export class VerifyMfaDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  code: string;
}
