import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AiService } from './services/ai.service';
import { AiChatService } from './services/ai-chat.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FastifyReply } from 'fastify';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private aiService: AiService,
    private aiChatService: AiChatService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('generate')
  async generate(@Body() body: { action?: string; content: string; prompt?: string }) {
    return this.aiService.generate(body.action as any, body.content, body.prompt);
  }

  @Post('generate/stream')
  async generateStream(
    @Body() body: { action?: string; content: string; prompt?: string },
    @Res() res: FastifyReply,
  ) {
    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for await (const chunk of this.aiService.generateStream(
      body.action as any,
      body.content,
      body.prompt,
    )) {
      res.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.raw.write('data: [DONE]\n\n');
    res.raw.end();
  }

  // Chat endpoints
  @HttpCode(HttpStatus.OK)
  @Post('chats/create')
  async createChat(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiChatService.createChat(user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('chats')
  async listChats(
    @Body() body: { limit?: number; cursor?: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiChatService.listChats(user.id, workspace.id, body);
  }

  @HttpCode(HttpStatus.OK)
  @Post('chats/info')
  async getChatInfo(
    @Body() body: { chatId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiChatService.getChatInfo(body.chatId, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('chats/delete')
  async deleteChat(
    @Body() body: { chatId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiChatService.deleteChat(body.chatId, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('chats/update')
  async updateChat(
    @Body() body: { chatId: string; title: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiChatService.updateChatTitle(
      body.chatId,
      body.title,
      user.id,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('chats/search')
  async searchChats(
    @Body() body: { query: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.aiChatService.searchChats(body.query, user.id, workspace.id);
  }

  @Post('chats/send')
  async sendMessage(
    @Body() body: { chatId?: string; content: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    res.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for await (const event of this.aiChatService.sendMessage(
      body.chatId,
      body.content,
      user.id,
      workspace.id,
    )) {
      res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    res.raw.write('data: [DONE]\n\n');
    res.raw.end();
  }
}
