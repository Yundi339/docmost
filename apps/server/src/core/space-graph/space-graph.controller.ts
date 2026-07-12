import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { RequireApiKeyScopes } from '../../common/decorators/api-key-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import { SpaceGraphDto } from './dto/space-graph.dto';
import { SpaceGraphService } from './space-graph.service';

@UseGuards(JwtAuthGuard)
@Controller('spaces/graph')
export class SpaceGraphController {
  constructor(private readonly graphService: SpaceGraphService) {}

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post()
  getGraph(
    @Body() dto: SpaceGraphDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.graphService.getGraph(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post('export')
  exportGraph(
    @Body() dto: SpaceGraphDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.graphService.exportGraph(dto, user, workspace);
  }
}
