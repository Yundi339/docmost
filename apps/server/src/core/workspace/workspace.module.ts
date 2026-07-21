import { Module } from '@nestjs/common';
import { WorkspaceService } from './services/workspace.service';
import { WorkspaceController } from './controllers/workspace.controller';
import { SpaceModule } from '../space/space.module';
import { WorkspaceInvitationService } from './services/workspace-invitation.service';
import { TokenModule } from '../auth/token.module';
import { CredentialSpaceAccessModule } from '../credential-space-access/credential-space-access.module';

@Module({
  imports: [SpaceModule, TokenModule, CredentialSpaceAccessModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceInvitationService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
