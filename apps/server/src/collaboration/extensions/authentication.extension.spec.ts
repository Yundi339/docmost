import { AuthenticationExtension } from './authentication.extension';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { SpaceRole } from '../../common/helpers/types/permission';

describe('AuthenticationExtension', () => {
  it('keeps a space reader readonly even when restricted page permission allows edit', async () => {
    const extension = new AuthenticationExtension(
      {
        verifyJwt: jest.fn().mockResolvedValue({
          sub: 'user-id',
          workspaceId: 'workspace-id',
          type: JwtType.COLLAB,
        }),
      } as any,
      {
        findById: jest.fn().mockResolvedValue({ id: 'user-id' }),
      } as any,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'page-id',
          spaceId: 'space-id',
          deletedAt: null,
        }),
      } as any,
      {
        getUserSpaceRoles: jest
          .fn()
          .mockResolvedValue([{ role: SpaceRole.READER }]),
      } as any,
      {
        canUserEditPage: jest.fn().mockResolvedValue({
          hasAnyRestriction: true,
          canAccess: true,
          canEdit: true,
        }),
      } as any,
    );
    const data = {
      documentName: 'page.page-id',
      token: 'collab-token',
      connectionConfig: {},
    } as any;

    await expect(extension.onAuthenticate(data)).resolves.toEqual({
      user: { id: 'user-id' },
    });
    expect(data.connectionConfig.readOnly).toBe(true);
  });
});
