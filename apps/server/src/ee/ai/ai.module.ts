import { Module } from '@nestjs/common';
import { AiService } from './services/ai.service';
import { AiChatService } from './services/ai-chat.service';
import { AiController } from './ai.controller';

@Module({
  controllers: [AiController],
  providers: [AiService, AiChatService],
  exports: [AiService, AiChatService],
})
export class AiModule {}
