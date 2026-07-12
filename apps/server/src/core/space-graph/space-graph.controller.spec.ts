import { GUARDS_METADATA } from '@nestjs/common/constants';
import { API_KEY_SCOPES_KEY } from '../../common/decorators/api-key-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import { SpaceGraphController } from './space-graph.controller';

describe('SpaceGraphController authorization', () => {
  it('requires JWT authentication at the controller boundary', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SpaceGraphController),
    ).toContain(JwtAuthGuard);
  });

  it.each(['getGraph', 'exportGraph'] as const)(
    'requires REST_READ for %s',
    (method) => {
      expect(
        Reflect.getMetadata(
          API_KEY_SCOPES_KEY,
          SpaceGraphController.prototype[method],
        ),
      ).toEqual([ApiKeyScope.REST_READ]);
    },
  );
});
