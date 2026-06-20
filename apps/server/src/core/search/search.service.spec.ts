import { SearchService } from './search.service';

describe('SearchService', () => {
  let pagePermissionRepo: { filterAccessiblePageIds: jest.Mock };
  let service: SearchService;

  beforeEach(() => {
    pagePermissionRepo = {
      filterAccessiblePageIds: jest.fn(),
    };
    service = new SearchService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      pagePermissionRepo as any,
    );
  });

  it('continues fetching page candidates until enough accessible results are found', async () => {
    const firstBatch = Array.from({ length: 200 }, (_, index) => ({
      id: `blocked-${index}`,
    }));
    const secondBatch = [{ id: 'allowed-1' }, { id: 'allowed-2' }];
    const fetchCandidates = jest
      .fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);
    pagePermissionRepo.filterAccessiblePageIds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['allowed-1', 'allowed-2']);

    await expect(
      (service as any).collectAccessiblePageResults(
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

  it('applies offset after page permission filtering', async () => {
    const rows = [
      { id: 'allowed-1' },
      { id: 'allowed-2' },
      { id: 'allowed-3' },
    ];
    pagePermissionRepo.filterAccessiblePageIds.mockResolvedValue([
      'allowed-1',
      'allowed-2',
      'allowed-3',
    ]);

    await expect(
      (service as any).collectAccessiblePageResults(
        jest.fn().mockResolvedValue(rows),
        'user-id',
        'space-id',
        1,
        1,
      ),
    ).resolves.toEqual([{ id: 'allowed-2' }]);
  });
});
