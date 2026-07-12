import {
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

export class PasskeyAuthenticationVerifyDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  challengeId: string;

  @IsObject()
  credential: Record<string, unknown>;
}

export class PasskeyRegistrationOptionsDto {
  @IsString()
  @MinLength(8)
  @MaxLength(70)
  currentPassword: string;
}

export class PasskeyRegistrationVerifyDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  challengeId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(80)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

  @IsObject()
  credential: Record<string, unknown>;
}

export class UpdatePasskeyDto {
  @IsUUID()
  passkeyId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(80)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;
}

export class DeletePasskeyDto {
  @IsUUID()
  passkeyId: string;

  @IsString()
  @MinLength(8)
  @MaxLength(70)
  currentPassword: string;
}
