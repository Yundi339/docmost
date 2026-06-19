import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

type DtoClass<T extends object> = new () => T;

export async function validateDto<T extends object>(
  cls: DtoClass<T>,
  input: Record<string, unknown>,
): Promise<T> {
  const dto = plainToInstance(cls, input);
  const errors = await validate(dto, {
    whitelist: true,
    stopAtFirstError: true,
  });

  if (errors.length > 0) {
    throw new BadRequestException(getValidationMessage(errors[0]));
  }

  return dto;
}

function getValidationMessage(error: any): string {
  if (error.constraints) {
    return Object.values(error.constraints)[0] as string;
  }

  const child = error.children?.find(
    (item: any) => item.constraints || item.children?.length,
  );
  if (child) {
    return getValidationMessage(child);
  }

  return `Invalid ${error.property}`;
}
