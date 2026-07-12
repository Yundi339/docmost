import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RequestEmailChangeDto {
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(70)
  @IsString()
  password: string;
}

export class ConfirmEmailChangeDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(40)
  @MaxLength(128)
  token: string;
}
