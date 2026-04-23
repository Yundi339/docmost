import { Module } from '@nestjs/common';
import { MfaModule } from './mfa/mfa.module';
import { SsoModule } from './sso/sso.module';
import { PageVerificationModule } from './page-verification/page-verification.module';
import { PagePermissionModule } from './page-permission/page-permission.module';
import { AiModule } from './ai/ai.module';
import { DocxImportModule } from './docx-import/docx-import.module';
import { AttachmentEeModule } from './attachments-ee/attachment-ee.module';
import { ConfluenceImportModule } from './confluence-import/confluence-import.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    MfaModule,
    SsoModule,
    PageVerificationModule,
    PagePermissionModule,
    AiModule,
    DocxImportModule,
    AttachmentEeModule,
    ConfluenceImportModule,
    McpModule,
  ],
})
export class EeModule {}
