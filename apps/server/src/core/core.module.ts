import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { PageModule } from './page/page.module';
import { AttachmentModule } from './attachment/attachment.module';
import { CommentModule } from './comment/comment.module';
import { SearchModule } from './search/search.module';
import { SpaceModule } from './space/space.module';
import { GroupModule } from './group/group.module';
import { CaslModule } from './casl/casl.module';
import { PageAccessModule } from './page/page-access/page-access.module';
import { ShareModule } from './share/share.module';
import { LabelModule } from './label/label.module';
import { NotificationModule } from './notification/notification.module';
import { WatcherModule } from './watcher/watcher.module';
import { FavoriteModule } from './favorite/favorite.module';
import { SessionModule } from './session/session.module';
import { TemplateModule } from './template/template.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { DatabaseFeatureModule } from './database/database.module';
import { SpaceGraphModule } from './space-graph/space-graph.module';

@Module({
  imports: [
    UserModule,
    AuthModule,
    WorkspaceModule,
    PageModule,
    AttachmentModule,
    CommentModule,
    FavoriteModule,
    SearchModule,
    SpaceModule,
    GroupModule,
    CaslModule,
    PageAccessModule,
    ShareModule,
    LabelModule,
    NotificationModule,
    WatcherModule,
    SessionModule,
    TemplateModule,
    ApiKeyModule,
    SystemStatusModule,
    DatabaseFeatureModule,
    SpaceGraphModule,
  ],
})
export class CoreModule {}
