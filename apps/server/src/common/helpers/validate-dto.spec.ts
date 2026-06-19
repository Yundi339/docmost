import { BadRequestException } from '@nestjs/common';
import { CreateSpaceDto } from '../../core/space/dto/create-space.dto';
import { validateDto } from './validate-dto';

describe('validateDto', () => {
  it('reuses DTO transforms and strips unknown fields', async () => {
    const dto = await validateDto(CreateSpaceDto, {
      name: '  Internal  ',
      slug: 'Internal123',
      extra: 'ignored',
    });

    expect(dto.name).toBe('Internal');
    expect((dto as any).extra).toBeUndefined();
  });

  it('throws BadRequestException for DTO validation failures', async () => {
    await expect(
      validateDto(CreateSpaceDto, {
        name: 'A',
        slug: 'invalid-slug',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
