import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards an explicit owner recovery request into the shared login flow', async () => {
    const user = { id: 'owner-id' } as any;
    const workspace = { id: 'workspace-id', enforceSso: true } as any;
    const authenticatePassword = jest.fn().mockResolvedValue(user);
    const begin = jest.fn().mockResolvedValue({ authToken: 'token' });
    const setAuthCookie = jest.fn();
    (controller as any).authService = { authenticatePassword };
    (controller as any).loginFlowService = { begin };
    (controller as any).authCookieService = { setAuthCookie };

    await controller.login(workspace, {} as any, {
      email: 'owner@example.com',
      password: 'password',
      ownerRecovery: true,
    });

    expect(begin).toHaveBeenCalledWith(user, workspace, {
      primaryAuth: 'password',
      ownerRecovery: true,
    });
    expect(setAuthCookie).toHaveBeenCalledWith({}, 'token');
  });
});
