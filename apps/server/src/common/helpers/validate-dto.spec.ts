import { BadRequestException } from '@nestjs/common';
import { CreateSpaceDto } from '../../core/space/dto/create-space.dto';
import { CreateCommentDto } from '../../core/comment/dto/create-comment.dto';
import { MovePageToSpaceDto } from '../../core/page/dto/move-page.dto';
import { SearchDTO } from '../../core/search/dto/search.dto';
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

  it('trims search queries and coerces bounded pagination values', async () => {
    await expect(
      validateDto(SearchDTO, {
        query: '  cloud docs  ',
        limit: '10',
        offset: '5',
      }),
    ).resolves.toMatchObject({
      query: 'cloud docs',
      limit: 10,
      offset: 5,
    });
  });

  it('rejects invalid UUID identifiers', async () => {
    await expect(
      validateDto(MovePageToSpaceDto, {
        pageId: 'page-id',
        spaceId: 'space-id',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects oversized comment content', async () => {
    await expect(
      validateDto(CreateCommentDto, {
        pageId: '018f3f73-2f69-7c8d-9d79-8f3f4d7d9711',
        content: JSON.stringify('x'.repeat(500_001)),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
