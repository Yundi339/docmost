import { SearchAttachmentsService } from './search-attachments.service';

describe('SearchAttachmentsService', () => {
  let pagePermissionRepo: { filterAccessiblePageIds: jest.Mock };
  let service: SearchAttachmentsService;

  beforeEach(() => {
    pagePermissionRepo = {
      filterAccessiblePageIds: jest.fn(),
    };
    service = new SearchAttachmentsService(
      {} as any,
      pagePermissionRepo as any,
      {} as any,
    );
  });

  it('continues fetching attachment candidates until enough accessible rows are found', async () => {
    const firstBatch = Array.from({ length: 200 }, (_, index) => ({
      id: `blocked-${index}`,
      pageId: `blocked-page-${index}`,
    }));
    const secondBatch = [
      { id: 'attachment-1', pageId: 'allowed-page-1' },
      { id: 'attachment-2', pageId: 'allowed-page-2' },
    ];
    const fetchCandidates = jest
      .fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);
    pagePermissionRepo.filterAccessiblePageIds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['allowed-page-1', 'allowed-page-2']);

    await expect(
      (service as any).collectAccessibleAttachmentRows(
        fetchCandidates,
        'user-id',
        undefined,
        0,
        2,
      ),
    ).resolves.toEqual(secondBatch);

    expect(fetchCandidates).toHaveBeenNthCalledWith(1, 200, 0);
    expect(fetchCandidates).toHaveBeenNthCalledWith(2, 200, 200);
  });
});
