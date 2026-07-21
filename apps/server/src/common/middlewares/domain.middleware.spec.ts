import { DomainMiddleware } from './domain.middleware';

describe('DomainMiddleware', () => {
  const workspace = {
    id: 'workspace-id',
    hostname: 'docs',
  };

  const createMiddleware = ({
    isSelfHosted,
    findActiveFirst,
    findActiveByHostname,
  }: {
    isSelfHosted: boolean;
    findActiveFirst?: jest.Mock;
    findActiveByHostname?: jest.Mock;
  }) =>
    new DomainMiddleware(
      {
        findActiveFirst: findActiveFirst ?? jest.fn(),
        findActiveByHostname: findActiveByHostname ?? jest.fn(),
      } as any,
      {
        isSelfHosted: () => isSelfHosted,
        isCloud: () => !isSelfHosted,
      } as any,
    );

  it('sets workspace context on both wrapped and raw requests in self-hosted mode', async () => {
    const next = jest.fn();
    const req: any = { raw: {}, headers: {} };
    const middleware = createMiddleware({
      isSelfHosted: true,
      findActiveFirst: jest.fn().mockResolvedValue(workspace),
    });

    await middleware.use(req as any, {} as any, next);

    expect(req).toMatchObject({
      workspaceId: 'workspace-id',
      workspace,
      raw: {
        workspaceId: 'workspace-id',
        workspace,
      },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets null workspace context on both wrapped and raw requests when no workspace exists', async () => {
    const next = jest.fn();
    const req: any = { raw: {}, headers: {} };
    const middleware = createMiddleware({
      isSelfHosted: true,
      findActiveFirst: jest.fn().mockResolvedValue(null),
    });

    await middleware.use(req as any, {} as any, next);

    expect(req).toMatchObject({
      workspaceId: null,
      raw: {
        workspaceId: null,
      },
    });
    expect(req.workspace).toBeUndefined();
    expect(req.raw.workspace).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses forwarded host without port when resolving cloud workspaces', async () => {
    const next = jest.fn();
    const findActiveByHostname = jest.fn().mockResolvedValue(workspace);
    const req: any = {
      raw: {},
      headers: {
        host: 'internal:3000',
        'x-forwarded-host': 'docs.example.test:23000',
      },
    };
    const middleware = createMiddleware({
      isSelfHosted: false,
      findActiveByHostname,
    });

    await middleware.use(req as any, {} as any, next);

    expect(findActiveByHostname).toHaveBeenCalledWith('docs');
    expect(req.raw).toMatchObject({
      workspaceId: 'workspace-id',
      workspace,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not bind a suspended or deleted cloud workspace', async () => {
    const next = jest.fn();
    const req: any = { raw: {}, headers: { host: 'docs.example.test' } };
    const middleware = createMiddleware({
      isSelfHosted: false,
      findActiveByHostname: jest.fn().mockResolvedValue(undefined),
    });

    await middleware.use(req as any, {} as any, next);

    expect(req.workspaceId).toBeNull();
    expect(req.raw.workspaceId).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
