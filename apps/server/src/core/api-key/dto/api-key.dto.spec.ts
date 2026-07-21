import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiKeyType } from '../api-key-scopes';
import { CreateApiKeyDto, FindApiKeysDto } from './api-key.dto';

describe('API key DTOs', () => {
  const futureExpiration = new Date(Date.now() + 60_000).toISOString();

  it('requires create requests to submit keyType explicitly', async () => {
    const dto = plainToInstance(CreateApiKeyDto, {
      name: 'REST key',
      expiresAt: futureExpiration,
      scopes: ['rest:read'],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'keyType')).toBe(true);
  });

  it.each([ApiKeyType.REST, ApiKeyType.MCP])(
    'accepts the %s keyType on create',
    async (keyType) => {
      const dto = plainToInstance(CreateApiKeyDto, {
        name: 'Typed key',
        expiresAt: futureExpiration,
        keyType,
      });

      await expect(validate(dto)).resolves.toEqual([]);
    },
  );

  it('accepts an optional valid keyType list filter', async () => {
    const unfiltered = plainToInstance(FindApiKeysDto, {});
    const filtered = plainToInstance(FindApiKeysDto, {
      keyType: ApiKeyType.MCP,
    });
    const invalid = plainToInstance(FindApiKeysDto, { keyType: 'mixed' });

    await expect(validate(unfiltered)).resolves.toEqual([]);
    await expect(validate(filtered)).resolves.toEqual([]);
    expect(await validate(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'keyType' }),
      ]),
    );
  });
});
